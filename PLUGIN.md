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

`previewAssetSource` と `reorderAssets` は絶対パス、`..`、symlink escape を拒否します。`importAssetImage` / `importAssetAudio` の `sourcePath` は読み取り元として dialog 由来の絶対パスを許可しますが、保存される `source` / generated file path は必ず project 相対です。BMP / WebP は renderer 側で PNG Data URL (`convertedDataUrl`) に変換してから import します。MP3 入力は renderer の `audio-convert-ui` で WAV Data URL へ加工してから `importAssetAudio({ dataUrl, sourceFileName, originalFileName, processing })` に渡します。

ADPCM で `splitPolicy: "auto"` を指定すると、変換後の ADPCM が runtime 側の direct-buffered 安全上限を超える場合に `<id>_part01`, `<id>_part02`, ... の独立 asset として分割登録します。上限は `min(32767, 65536 - adpcmAddress)` bytes です。分割 asset は自動連続再生されないため、scene/message から必要な part を個別に参照してください。

ADPCM の `divider` は再生速度の rate code です。取り込み時は、`divider` 未指定なら `32000 / (16 - code)` が `sampleRate` に最も近い `0..15` の code を自動計算し、代表値は `32000Hz -> 15`, `16000Hz -> 14`, `8000Hz -> 12`, `4000Hz -> 8` です。エディターUIでは現行の入力範囲で実機rate codeに対応する `4000`, `4571`, `5333`, `6400`, `8000`, `10666`, `16000`, `32000` Hz から選択します。`divider` を明示した場合は保存値をそのまま使い、runtime 側でも旧式値としての補正は行いません。direct-buffered playback で安定して鳴らせる 1 asset / part の長さは `min(32767, 65536 - adpcmAddress)` bytes、つまり `bytes * 2 / sampleRate` 秒が目安です。`adpcmAddress: 0` なら 16000Hz で約 4.09 秒、8000Hz で約 8.19 秒です。`assets/generated/<id>/adpcm.bin` は OKI/MSM5205 互換 4-bit adaptive data を高位 nibble 先 (`msn-first`) で保存します。旧 `pce-cd-adpcm-experimental`、古い `lsn-first`、nibble order 未記録、または `encoderVersion` が古い generated file は、source WAV が残っていれば build/source 生成時に自動再生成されます。
ADPCM の true CD streaming (`pce_cdb_adpcm_stream`) は VN runtime / editor 機能から削除しました。ADPCM は常に ADPCM RAM へ読み込んでから buffered direct playback します。長い音声は `splitPolicy: "auto"` で分割する、sample rate を下げる、または CD-DA を使ってください。安全上限を超える ADPCM asset は build error になります。

`assets/pce-assets.json` の v2 画像/音声タイプは `image` (BG), `sprite`, `palette`, `psg-song`, `psg-sfx`, `adpcm`, `cdda-track` です。旧 `psg-sequence` は読み込み時に `psg-sfx` として正規化されます。PCE/CD-ROM2 は `llvm-mos-sdk` 固定で扱い、IPL / System Card は Setup でユーザー所有ファイルを指定します。

MIDI から PSG へ取り込む場合、`midiOptions` で変換の強さを調整できます。既定は聞き取り優先で、tone は最大 4 voice、drum は ch5 の控えめな PSG noise、tone 音量 100%、drum 音量 35%、`velocity < 8` を無視、過密時は bass と高音 melody を残す `melodyBass`、`patternDetail: "auto"` です。`drumMode: "off"` は drum を捨て、`"full"` は ch4/ch5 の noise を使います。`patternDetail` は `"full"` で全更新、`"half"` / `"quarter"` / `"eighth"` で更新密度を落とします。`"auto"` は 2048 pattern event を超える場合だけ 1/2→1/4→1/8 の順に更新密度を落として、曲の末尾まで残すことを優先します。`previewAssetMidi` / `assets:previewMidi` は同じ options で保存せずに pattern を返し、取込ダイアログの試聴に使います。MIDI の pitch bend / CC / program change は PSG pattern へは反映されません。PSG は最大 4096 step / 2048 pattern event で、CD-ROM2 VN build では大きい pattern を bank134+bank135 の 16KB buffer へストリームします。Sound > PSG / Asset manager / VN Audio command の preview は WebAudio による square/noise の疑似再生で、実機の波形・ミキサー特性を完全再現するものではありません。

BG の `tileBase` / `mapBase` は PCE asset manager 側で自動管理されます。CD-ROM2 VN runtime の 32x32 BAT を `mapBase: 0` に置き、BG tile は BAT の後ろ (`tileBase: 128`) に配置するため、UI ではこれらをユーザー選択させません。古い asset に値が残っていても読み込み・生成時に BG は自動値へ正規化されます。

CD-ROM2 VN build は asset catalog を常に使います。標準保証ラインは、VN から参照される BG / Sprite / ADPCM / PSG が各 512 件までです。`pce_editor_*_asset_count` と `pce_editor_meta_region_t.count` は `unsigned int` とし、runtime は scene command の signed index を `0..count-1` で検証してから使います。CD-DA は物理 track の制約により track 2..99（最大 98 本）だけを有効とし、重複 track は build error です。Catalog では BG / Sprite / ADPCM に加えて PSG / CD-DA metadata も `assets/generated/meta/asset_meta.bin` へ置き、runtime は BG descriptor 8 枠（direct-mapped）、Sprite descriptor 4 枠の metadata cache で小さな catalog 再読込を抑えます。短い PSG SFX も pattern CD data file として扱います。詳細は `docs/pce-asset-meta-cd-ondemand.md` を参照してください。

`targetMedia: "cd"` の PCE VN build では、generated image の tile data、VRAM 幅へ展開した BG map、sprite pattern、ADPCM 本体を RAM bank へ詰め込まず、project 相対パスのまま `cd.dataFiles` へ登録します。VN script 本体も `assets/generated/vn/scenes/NNN_<sceneId>.bin` の scene pack として `cd.dataFiles` に並べ、bank132 には sprite animation、variable 初期値、`pce_vn_scene_packs[]` の sector directory、font tiles の CD data ref (`pce_vn_font_data`)、asset の CD data ref (`pce_editor_cd_data_ref_t`) だけを常駐させます。**グリフフォント本体は `assets/generated/vn/font.bin` として `cd.dataFiles` の先頭 (CD sector 64) に並べ、起動時に 1 回だけ VRAM へストリーム転送します**（bank132 に font tiles を常駐させないため、使用文字種を増やしても bank132 が溢れません）。font.bin の中身は表示用の先焼きタイルではなく **12×12 1bpp マスク（1 glyph = 12 word = 24 byte）**で、起動時に `PCE_VN_FONT_MASK_VRAM_WORD` 以降の VRAM へ転送します。

CD runtime は message 開始時にそのページの glyph mask だけを `.ram_bank132` cache へ先読みし、runtime のグリフコンポジタ（bank133 overlay = `VN_OVERLAY_CODE`）は resident dispatcher 経由で IRQ を mask したまま bank133 を map し、bank130 へ復帰してから IRQ を戻したうえで、cache を優先し、12px 横ピッチで合成します（cache 外 glyph だけ VRAM から fallback 読み、メッセージ帯 208 タイルを read-modify-write）。メッセージ/選択肢の glyph ストリームはバイト指向で、glyph index 0..252 は 1 byte、253 以上は `0xfd` エスケープ + 16bit little-endian index で符号化します（stream byte `0xfe` = 改行、`0xff` = 終端。runtime はこれらをそれぞれ 16bit の `PCE_VN_GLYPH_NEWLINE`(0xfffe) / `PCE_VN_GLYPH_END`(0xffff) に復号するので、エスケープした実 index と衝突しません）。これにより使用文字種は旧 254 種上限を超えられ、実際の上限はマスクを置く VRAM のみで決まります（既定 `tileBase` でおよそ 1000 種 = `VN_MAX_GLYPH_COUNT`）。build 時に `generateVnSources()` の `computeFontBudget()` がマスク領域末尾 (SATB `0x7f00`) を検査し、超過は build error、上限接近 (`VN_GLYPH_COUNT_SOFT_WARN` 種以上 / VRAM tile 1728 超) や `VN_MAX_GLYPH_COUNT` を超えた文字の切り捨ては build ログに警告 (`warn`) を出します。インデックス 253 以上の文字は 1 文字 3 byte になるため、その文字を多用する scene が 4096 byte の active cache を超える場合は scene を分割してください（build error で検知）。なお `spritetext` overlay 用フォントは別系統で、従来どおり最大 254 glyph・1 byte index のままです。

各 scene pack は pointer を持たない little-endian / offset ベース形式で、runtime は scene 入場時に active cache (`4096` bytes) へ読み込みます。明示的な `preload` command は削除済みです。読み込み最適化は scene 入場時の内部 preload が担当します。VN build は各 scene pack をその scene が参照する BG/Sprite/ADPCM data file より前に並べ、build は IPL program の後ろへ padding file を挟み、最初の data file が固定の CD sector 64 から始まるように配置します。padding のサイズは固定ではなく、ELF build 後に `pce-mkcd -v` でプログラム像の実セクタ数を測定し `PCE_CD_DATA_BASE_SECTOR(64) - (program 終端 sector)` で算出します（`finalizePceCdDataPadding()`）。font tiles を bank132 から CD data file へ移すなどで program 像のサイズが変わっても、埋め込んだ sector 64 と実 ISO 配置を一致させ続けるためです。固定 padding のままだと program 縮小で data が前倒しになり、`pce_vn_font_data` 等の sector 参照がずれて全画面 BAT が壊れた glyph で埋まります。

runtime は scene 入場時に script pack を active cache へ読み、暗転中なら最初の待ちコマンドまでに必要な BG/Sprite/ADPCM だけを active cache から先読みし、表示 command では固定 VRAM 領域へ反映します。さらに generator は voice 付き `message` の直前へ内部 `Cache Load ADPCM` を挿入し、手動で同じ ADPCM の cache load が直前にある場合だけ重複を避けます。ボタン待ち message の完了待機中には、次の ADPCM cache load を先取りしません。`background` / `sprite` 表示 command は、VRAM/BAT/SATB 反映、必要な暗黙 fade、表示 layer の再有効化まで完了してから次 command へ進む同期 command です。CD-DA と CD data read は同時に行えないため、script pack や画像/sprite/ADPCM の CD data file を読む場合は runtime が CD-DA を `pce_cdb_cdda_pause()` で止めます。CD-DA を維持したい scene では、BG/Sprite command を CD-DA の前に置いてください。ADPCM 読み込みに失敗した場合はロード済みにせず再生もしません。再生前に ADPCM metadata を local snapshot へコピーし、BIOS helper 後に MPR が変わっても length/divider/sector を読み間違えないようにします。Message voice は build 時点で buffered-only に制限され、可視 glyph を描く前に buffered direct playback を開始します。buffered playback は `pce_cdb_adpcm_play()` を使わず、ADPCM hardware に長い length (`0xffff`) を latch して開始し、runtime が frame counter で数 frame 早く direct stop / loop restartします。true CD streaming への runtime fallback はありません。長い message voice は `splitPolicy: "auto"` で 32767 byte 以下の part に分ける、sample rate を下げる、または CD-DA へ逃がしてください。

CD-DA と visual payload の補足: 上記の pause は CD data read 区間の制約です。raw BG/Sprite payload は、1 sector の CD read が終わるたびに CD-DA を再開し、`cd_transfer_scratch` または visual RAM cache から VRAM/BAT へ書き込む間は pause を引きずらないようにします。RAM→VDC data port 転送は HuC6280 の TIA block transfer を使います。PSG 再生中は VRAM 転送を約32 byteごとに区切り、slice ごとに PSG service と MPR 復帰を挟みます。CD settle の補償 tick は PSG 専用で、ADPCM の再生残フレームは実 VBlank credit だけで減らします。PSG が鳴っていない場面では 1 sector までまとめて転送し、full-width BG map は行ごとの 64 byte copy ではなく連続 BAT copy にして、Image command の反映時間を短縮します。BG/Sprite の `cache load` は実験版として低位 System Card RAM へ payload を先読みしますが、VRAM/BAT/SATB へ反映するのは `background` / `sprite` command 実行時だけです。

VN scene command には `cache` を持てます。`clear` 形式は `{ "type": "cache", "action": "clear", "scope": "visual" }` で、`scope` は `visual` / `bg` / `sprite` / `adpcm` / `psg` / `all` です。これは旧 `preload` の復活ではなく、runtime の読み込み済み判定だけを無効化して、次回の `background` / `sprite` / `audio` / `message.voiceAssetId` で再ロードさせるための command です。`visual` は BG + Sprite、`psg` は bank134/135 の PSG pattern cache、`all` は visual + ADPCM + PSG + message glyph cache を対象にします。VRAM/BAT/SATB、ADPCM controller、再生中の CD-DA/PSG、active scene pack、変数は clear しません。scene pack record は既存 19 byte のまま `type = PCE_VN_COMMAND_CACHE`、`flags = PCE_VN_CACHE_ACTION_CLEAR`、`arg0 = PCE_VN_CACHE_SCOPE_*` を使います。

`load` 形式は `{ "type": "cache", "action": "load", "scope": "bg", "assetId": "bg_id", "x": 0, "y": 0 }`、`{ "type": "cache", "action": "load", "scope": "sprite", "assetId": "sprite_id", "slot": 0 }`、`{ "type": "cache", "action": "load", "scope": "adpcm", "assetId": "voice_id" }`、`{ "type": "cache", "action": "load", "scope": "psg", "assetId": "song_id" }` です。1 command につき1 assetを対象にし、scene pack command record は19 byteのまま `flags = PCE_VN_CACHE_ACTION_LOAD`、`arg0 = scope`、`assetIndex` / `slot` / `x` / `y` を使います。ADPCM load は再生中なら何もせず、停止中だけADPCM RAMへ読み込みます。PSG load は banked PSG pattern を bank134/135 の単一 buffer へ先読みし、`Audio PSG Play` は cache hit なら CD read なしで開始します。現在再生中の PSG が同じ bank134/135 を使う banked pattern の場合は、現曲を壊さないため PSG load は安全に skip します。voice 付き message の直前には generator が同等の内部 ADPCM load を自動挿入します。BG load は BG tiles と map を、Sprite load は sprite pattern payload を visual RAM cache へ読み込みます。どちらも VRAM/BAT/SATB、`sprite_slots[]`、現在の表示状態を変更しません。cache hit した表示 command は CD read なしで RAM cache から VRAM/BAT へ転送し、evict 済みなら従来どおり CD→scratch→VRAM に fallback します。

メッセージ開始時の window clear と初回全文表示（速度0など）は、208 タイル以上のメッセージ帯 VRAM を連続更新するため、runtime がメッセージ窓 BAT だけを一時的に blank tile へ向けてから実行し、完了後に次の VBlank で strip BAT へ戻します。表示途中のボタンスキップでは窓を blank にせず、現在の glyph cursor から残りの文字を連続描画して既存テキストを消さないようにします。typewriter 中の通常の 1 glyph 更新は、bank133 overlay dispatcher の IRQ guard と glyph mask cache を使って短い VDC 更新に抑えます。ボタン送り待ちの完了ページでは、4 行目の最後の 1 セルを予約し、本文の代わりに `▼` を点滅表示します。このため message 本文は 1〜3 行目が 17 文字、4 行目が 16 文字として折り返されます。自動送りメッセージでは `▼` は表示しません。

**Windows 固有: `pce-mkcd.exe` は MinGW ランタイム DLL に依存します。** llvm-mos-sdk の LLVM 系ツール（clang / ld.lld / llvm-objcopy）は静的リンクですが、`pce-mkcd.exe` だけは MinGW-GCC ビルドで `libstdc++-6.dll` / `libgcc_s_seh-1.dll` / `libwinpthread-1.dll` を動的に必要とします。SDK はこれらを exe の隣に同梱しないため、実行時は PATH から解決されます。ターミナル（Git Bash / MSYS2 等）の PATH には互換 DLL があり動きますが、**Electron の PATH には無いことが多く、見つからない (exit `0xC0000135`) か、ABI 非互換の DLL をロードして実行時にクラッシュ (exit `0xC0000005` = `3221225781`) します**（macOS は該当依存が無いため起きません）。DLL 検索は exe と同じフォルダが PATH より優先されるため、build は mkcd 実行前に `ensurePceMkcdRuntimeDlls()`（[pce-build-system.js](pce-build-system.js)）で、これらが exe の隣に無ければ MinGW/MSYS2/Git の bin から**完全な一組だけ**を選んでコピーします。コピー元が見つからない場合は cryptic な segfault でなく、DLL を `pce-mkcd.exe` と同じフォルダに置くよう促す明確なエラーを出します。

**Windows 固有: `ld.lld.exe` が Application Control に拒否される場合があります。** `clang.exe` は起動できても、linker の `ld.lld.exe` だけが Windows Application Control / Smart App Control / WDAC により `Application Control policy has blocked this file` で停止することがあります。この場合は HuCARD / CD-ROM2 どちらの build も link できません。build は compile 前に `ld.lld.exe --version` を preflight し、起動できない場合は project / C source のエラーと区別して `llvm-mos linker を起動できません` を返します。対処は Windows 側でその `ld.lld.exe` を許可するか、SetUp で実行可能な `llvm-mos-sdk` を指定することです。

**VRAM 領域の排他予約（VN build）。** PCE VRAM は 32768 word の単一空間で、BAT(0–1024)、BG タイル、メッセージフォント/グリフマスク、spritetext フォント、スプライト pattern、SATB(0x7f00–) を各々独立規則で配置します。これらが重なるとレイアウトが破壊されるため、`generateVnSources()` は `validateVnVramLayout()`（[pce-vn-manager.js](pce-vn-manager.js)）で全領域を word range に展開し、**異なるカテゴリ間の重なりを検出したら build error**で停止します（どの 2 領域が word いくつで重なるかを表示）。BG 同士は `background` ごとに差し替えるため同カテゴリ内の重なりを許容し、BG カテゴリは所属 asset の union extent で判定します。スプライトは scene 中の visible SLOT 状態を追跡し、最初の visible SLOT の `tileBase` から SLOT0→SLOT1→SLOT2→SLOT3 の順に pattern を非重複配置した最大同時表示 range で判定します。sprite palette bank も最初の visible SLOT の `paletteBank` からSLOT順に `+1` して割り当て、spritetext予約bankへ届く構成は build error にします。重なった場合は BG/スプライト/メッセージのいずれかを縮小するか tileBase/paletteBank を調整してください。

**BG/Sprite の visual payload は常に無圧縮（raw）です。** 以前あった RLE 圧縮（`tiles.rle` / `map_vram.rle` / `patterns.rle` sidecar）と `options.compression` オプション/UI は撤去しました。RLE streaming デコーダが VDC の書き込みアドレスを CD 読み込みを跨いで保持して BG 破壊の原因になり、かつ bank133 overlay の約 87% を占めていたためです（dithered 写真 BG では RLE が ~13% しか効かず CD 増分も軽微）。変換は raw の `tiles.bin` / `map_vram.bin` / `patterns.bin` だけを生成し、`cd.dataFiles` と generated C metadata は常にこの raw を参照します（`pce_editor_cd_data_ref_t.compression` は常に `0`=NONE）。runtime は CD sector を `cd_transfer_scratch` へ 1 セクタずつ読み、resident/noinline かつ IRQ guard 付きの `pce_editor_vram_copy()` で VRAM へ転送します（MAWR を CD 読み込みを跨いで保持せず、MAWR 設定から VRAM data 転送までは IRQ を mask）。CD-ROM2 ではこの helper が HuC6280 の TIA block transfer で `cd_transfer_scratch` / generated data から VDC data port へ送ります。PSG 再生中は従来どおり約32 byte sliceで cooperative service を挟み、PSG が鳴っていない場面は最大 1 sector の大きい slice と full-width BG map の連続 BAT copy で Image command 反映を短縮します。この helper は SDK の `pce_vdc_set_copy_word()` を使わず、R5 high byte の DRAM refresh / VBlank status latch bit を維持します。`write_map_words()` の BAT 行更新も同じ helper を通ります。`pce_editor_cd_data_ref_t` は bank128 の常駐 `.rodata` を圧迫しないよう bank132 に置きます。旧プロジェクトに残る `.rle` / `compression: "auto"` メタは無視され（raw を使用）、再生成時に NONE へ正規化されます。

ADPCM は CD 上の payload を bank122 の direct CD/SCSI async helper で ADPCM RAM へ流し込み、32767 bytes 以下の buffered playback は System Card BIOS の `pce_cdb_adpcm_play()` を使わず direct ADPCM latch / direct stop で制御します。direct latch は ADPCM read address / `0xffff` length / divider を設定し、runtime が generated `play_frames` で PLAY bit を落とすか loop restart します。実データ長を hardware length に入れると通常再生の中間地点で ADPCM half IRQ (`0x04`) が立ち、Geargrafx では System Card IRQ path が VDC/PSG state を壊すため使いません。安全上限超過は build/import 時に分割または error とし、true CD streaming へ fallback しません。CD から ADPCM RAM へ読む場合、runtime は `vn_wait_next_vblank_raw()` + `engine_service()` + `vn_cd_async_service_frame()` の loading frame で SCSI DATA IN を `IO_PCD_ADPCM_DATA` へ書き、async data phase 中は System Card BIOS helper / external IRQ / `quiet_cd_unit_irqs()` を使いません。message 開始時に cache miss した場合だけ、可視 glyph を描く前に同じ direct async path で ADPCM RAM へ読み込みます。自然終了監視では System Card BIOS の ADPCM status polling に頼らず、generated catalog の `play_frames` で one-shot / buffered loop の終了や再発行を管理します。標準 EmulatorJS/WASM core では buffered ADPCM one-shot の完了IRQで CPU が止まることがあるため、buffered 再生中の CD unit IRQ / System Card pending latch は runtime 側で消します。ADPCM 再生開始後は次の joypad edge 判定を一度だけ初期化します。暗転中 preload では意図した暗転を維持します。VN の audio command は buffered direct playback を開始したら待ち状態を返さず次の command へ進みます。ただし未 preload の通常 ADPCM は、再生開始前の ADPCM RAM 読み込みだけ同期的に完了待ちします。

ADPCM のデータ/再生経路切り分けには `samples/pce-adpcm-diagnostic` を使います。`node scripts/pce-adpcm-diagnostic.js analyze <source.wav> <adpcm.bin> <sampleRate>` は generated ADPCM を OKI/MSM5205 と旧実験形式、low/high nibble first の各組み合わせで decode し、元 WAV との RMS error、SNR、correlation を出します。`node scripts/pce-adpcm-diagnostic.js build` は VN runtime を通らず BIOS の ADPCM helper だけを呼ぶ最小 CD-ROM2 ISO を作ります。`I` は high-nibble-first buffered、`II` は low-nibble-first buffered、`SELECT` は停止です。

CD-ROM2 RAM bank の標準ルールは `docs/pce-memory-bank-strategy.md` にまとめています。要点は、bank129 を VN runtime の `VN_BANKED_CODE`、bank130 を 2 本目の `VN_BANKED_CODE2`、bank132 を sprite animation / variable 初期値 / scene pack directory / font tiles と asset の CD data ref などの小さい VN generated data、bank133 を Path B overlay（message グリフコンポジタなど）に分けることです。BG/Sprite visual payload RAM cache は実験版として bank121 に helper code (`visual_code.bin`) を読み込み、bank104-119 を 8KB x 16 page の payload cache として使います。これらの cache page は `--print-memory-usage` 上は空いて見えても runtime 専用領域なので、別用途に割り当てないでください。bank122 は direct CD/SCSI async helper (`cd_async_code.bin`) 用で、scene pack の CPU RAM read と ADPCM RAM load は `vn_wait_next_vblank_raw()` + `engine_service()` + `vn_cd_async_service_frame()` の loading frame で進め、async data phase 中は `quiet_cd_unit_irqs()` を呼びません。`visual_code.bin` / `cd_async_code.bin` 抽出後は main ELF の bank121 / bank122 `PT_LOAD` も無効化し、`pce-mkcd` の初期ロード対象へ混ざらないようにします。script pack・画像/sprite/ADPCM の大きい payload・グリフフォント本体は CD data file のまま扱い、bank129 / bank130 / bank132 へ asset data を混ぜないでください。

PCE background conversion は、入力画像の各 8x8 cell を表示順の tile としてそのまま出力します。同一内容の tile を dedupe しないため、VN の背景切替では絵が過度に共通タイル化されず、raw の `tiles.bin` は `width / 8 * height / 8 * 32` bytes を基準に扱われます。CD-ROM2 でも visual payload は raw の `tiles.bin` / `map_vram.bin` / `patterns.bin` を使い、表示 command 実行時に CD→scratch→VRAM へ chunked 転送します。同一 slot へ別 sprite asset をロードする場合は、runtime が sprite layer を一度無効化して未使用 entry を画面外へ逃がした SATB を反映し、pattern VRAM を転送してから SATB と sprite layer を戻します（PCE ではゼロ SATB entry も実 sprite なので、無効化には使いません）。**sprite pattern は background tile と違い、同一内容の表示 cell block を dedupe します。** 変換時に sheet の `cellWidth` × `cellHeight` cell を比較し、ユニークな block だけを `patterns.bin`（= VRAM 転送本体）へ詰めます。16×16 cell は 128 byte の pattern 1 個、32×64 cell は 16×16 pattern 8 個が連続した block になります。各 positional display cell → ユニーク block slot の対応表を `cellmap.bin`（1 byte/cell）として出力します。`generated.tileCount` / `vramBytes` は dedupe 後の 16×16 pattern 数 / byte 数で算出し、`pce_editor_sprite_asset_t.cell_map` に `cellmap.bin` を resident 配列として埋め込みます。runtime の `show_character_sprite_frame()` は positional display cell を `cell_map[]` 経由で VRAM slot へ解決するため、目パチ・口パクなど frame 間で共通する cell block が 1 枚に畳まれ、VN の VRAM 予算（message tile・font mask・SATB を除いた残り）に大きな多 frame sheet を収められます。ユニーク block が 256 を超える sheet は build error（cell map は 1 byte index 上限）。

sprite pattern 領域は SATB (`0x7f00`) より手前に収めます。`tileBase`（= `pattern_base`、既定 `704` = VRAM word 22528）は message/font tile より後ろ・SATB より前の、VN runtime が character sprite を配置する領域の開始位置です。複数SLOTを同時表示するときは SLOT0 から順に使う運用とし、runtime は最初の visible SLOT の `tileBase` から各SLOTの `patterns.bin` を順に詰め、sprite palette も最初の visible SLOT の `paletteBank` からSLOT順に割り当てて、SLOT1のロードでSLOT0の pattern / palette を上書きしないようにします。**同時表示SLOTの合計 pattern が `0x7f00` を超える場合、または palette bank が予約bankへ届く場合は build error（旧実装の warning 止まりをやめ、壊れた ROM の生成を防止）**。tileBase が message tile (`PCE_VN_FONT_TILE_BASE`=712 以降) に被ると message glyph と blank tile を壊し、font 色を変えた余白が化け、SATB まで上書きされるため、large sheet は必ず dedupe + 安全な tileBase で配置します。同一 sprite sheet 内の目パチ・口パク frame 変更では pattern を再転送せず、SATB の frame 参照だけを更新します。別 sprite asset への差し替えや既存SLOTの実配置範囲を上書きする場合は、表示無効化 → VRAM/palette 転送 → SATB/display 有効化の順で同期し、pattern 書き換え中の中間表示を出しません。追加SLOTの転送が既存SLOTのpattern/palette範囲に触れない場合は、表示中のSLOTを隠さずに転送します。

PCE background conversion は、入力画像の各 8x8 cell を表示順の tile としてそのまま出力します（sprite と異なり dedupe しません）。VN の背景切替では絵が過度に共通タイル化されず、raw の `tiles.bin` は `width / 8 * height / 8 * 32` bytes を基準に扱われます。CD-ROM2 でも `tiles.bin` / `map_vram.bin` を raw のまま使い、`cache load bg` は tiles と map を visual RAM cache へ先読みします。実際の VRAM/BAT 反映は `background` command 実行時だけです。

VN sprite runtime は sprite asset descriptor の cell size、sheet cell 数と、SLOT順に割り当てた実 pattern base / palette bank を slot ごとのローカル描画メタへスナップショットしてSATBを組みます。palette / pattern の data ref と `cell_map` も helper 呼び出し前に退避するため、32x64 のSLOT0と16x64のSLOT1のように cell size が違う asset を連続表示しても描画メタが混ざりません。animation metadata が sheet 範囲内なら `frame_count: 1` の default でも 1 frame の表示サイズとして使い、frame size 未指定時は generator 側で sprite sheet 全体表示へ正規化します。VDC memory control は `VN_VDC_MEMORY_CONTROL` (`VDC_CYCLE_4_SLOTS | VDC_BG_SIZE_32_32`) を使い、BG size 更新時に sprite cycle bit を落とさないでください。

CD-ROM2 VN runtime では `map_vram.bin` を `mapBase` から一括転送しません。raw `map_vram.bin`（無圧縮）は `VN_MAP_WIDTH`(=32)タイル幅のソース行として読み、各行の `width_tiles` 分だけを `mapBase + command.y * 32 + command.x + row * 32` へコピーします。これにより、224px背景を256px画面へ配置したときの左右余白は blank tile のまま残り、CD上の0埋めpaddingや古いVRAM tileが縦枠として表示されません。BG 画像は 256px(32 タイル)以下にしてください（`encodePceBackground` が超過時にビルドエラー）。BG command の切替は Fade 前提で、エディタは `cut` を表示しません。`fadeOutFrames` / `fadeInFrames` は速度プリセット `10 / 20 / 30 / 40 / 50 / 60` から選び、未指定時は速度3の `30` です。保存済みの旧 `transition: "cut"` は読み込み時に `transition: "fade"` へ正規化されます。fade は BG palette bank だけを段階変更し、display layer 全体を落とさないため、下部メッセージ領域や UI palette まで暗転させません。BG の VRAM/BAT 転送と fade 完了まで次 command へ進みません。

Sprite asset は `options.animations` で VN runtime 向けの差分アニメーションを定義できます。各 entry は `id`, `name`, `frameWidth`, `frameHeight`, `firstCell`, `frameCount`, `frameDelay`, `frameDelays`, `frameStrideCells`, `loop` を持ちます。未指定時は sprite sheet 全体を 1 frame とする `default` animation が生成時に補われます。`firstCell` と `frameStrideCells` は、PCE 16x16/16x32/32x32 などの sprite cell を左上から数えた index です。

**各フレームの表示時間（per-frame display time）**: `frameDelay` は全フレーム共通の既定値、`frameDelays`（長さ `frameCount` の配列）は **1 フレームごとの表示フレーム数**です。スプライトエディタの time フィールド（`spriteEditor.time` = `[[行0…][行1…]]` 行列、1 行 = 1 animation）から保存され、build 時に各 animation の per-frame テーブルとして `vn.c` に出力されます（`pce_vn_sprite_anim_delays_N[]`、resident rodata）。`pce_vn_sprite_anim_t.frame_delays` がこのテーブルを指し、runtime の `tick_sprite_animations()` は **現在フレームの `frame_delays[frame]`** で各フレームを送ります（空セルや legacy data で `frame_delays` が無い場合は `frame_delay` にフォールバック）。`frameDelays` を持たない旧 asset でも、`spriteEditor.time` 行列があれば正規化時に per-frame 値へ移行します。time フィールドは右ペインから直接編集でき、上部の Time フィールド（ROW/Frame 選択）でセル単位の編集も可能です。

CD-ROM2 VN template は builder role に `pce-visual-novel-builder` を使います。VN runtime は `template/template_pce_vn_cd/src/pce_vn_runtime.c` を共通実体とし、各 project の `src/main.c` は `#include "pce_vn_runtime.c"` の薄い wrapper です。build 本体の `pce-vn-manager.prepareVisualNovelBuild()` が build 前に `main.c` と `pce_vn_runtime.c` を project `src/` へ同期します。Test Play など `skipClean` 付きの build では、`assets/generated/vn/build-stamp.json` の署名が一致し、必要な generated output が残っている場合に VN スクリプト生成をスキップします。生成後の source/CD data/toolchain 入力と出力が `out/build-stamp.json` と一致する場合は、compile/link/mkcd もスキップして既存出力を再利用します。`plugins/pce-visual-novel-builder` の `onBuildStart` は重い VN 生成を先に実行せず、開始ログだけを出します。runtime の変更はこの共通 source を更新してください。

HuCARD VN template は builder role に `pce-visual-novel-hucard-builder` を使い、`template/template_pce_vn_hucard` から `.pce` だけを生成します。Novel editor の scene JSON と scene-pack command binary layout は CD-ROM2 VN と同じですが、runtime は `template/template_pce_vn_hucard/src/pce_vn_hucard_runtime.c` と `pce-vn-hucard-manager.js` の独立実装です。`pce-cd.h`、`pce-mkcd`、overlay extraction、`cd.dataFiles`、System Card BIOS 経路は使いません。HuCARD VN の generated `src/generated/vn.h` / `vn.c` は scene pack、font mask、spritetext font、PSG pattern を `pce_editor_data_ref_t` として参照し、`pce-asset-manager.generateAssetSources({ extraDataFiles })` の同じ ROM bank allocator に流します。このため HuCARD の 127 ROM bank を超える場合は build error になります。ADPCM / CD-DA audio command、`message.voiceAssetId`、ADPCM cache command は silent no-op で、HuCARD asset output には ADPCM / CD-DA metadata を出しません。PSG は HuCARD 専用の `pce_vn_psg_assets[]` と serialized pattern data を使い、song loop、SFX one-shot、base channel、ch4/ch5 noise、blocking visual/fade work 中の cooperative tick を runtime 側で処理します。HuCARD VN も `skipClean` 付き build では VN スクリプト生成スタンプと `out/build-stamp.json` の最終出力スタンプを使い、入力が変わっていなければ `.pce` の再リンクを行いません。Test Play は HuCARD ROM (`.pce`) を標準/外部 emulator に渡します。CD-ROM2 VN runtime/template の挙動はこの builder では変更しません。

HuCARD VN の bank layout は [docs/pce-vn-hucard-bank-layout.md](docs/pce-vn-hucard-bank-layout.md) を正とします。`rom_bank0` は起動、resident main loop、VDC state、data ref helper、小さい dispatch/metadata だけに残し、runtime worker code は `rom_bank1..4` に固定予約します。`pce-vn-hucard-manager.js` の `HUCARD_VN_RUNTIME_ROM_BANKS` と `template/template_pce_vn_hucard/src/pce_vn_hucard_banks.h` を同じ配置に保ってください。asset/VN data は `rom_bank5..127 @ slot6` だけを使い、HuCARD VN の `extraDataFiles` は 8KB 未満でも `forceBanked` として `pce_editor_data_ref_t` にします。HuCARD VN では BG / Sprite の generated visual payload も小さい palette / map を含めて banked data ref にし、bank0 `.rodata` に直置きしません。message font は 12x12 mask、1 glyph = 24 bytes の banked ROM data で、1000 glyph でも bank0 `.rodata` には置きません。scene pack は 4096 bytes cache 上限、spritetext font は別枠 254 glyph 上限を維持し、超過は build error としてください。

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

scene の `name` はエディタ表示用の任意名です。`chapter1/opening` のように `/` で区切ると Novel > スクリプトの Scenes 一覧ではグループ見出しと leaf 名に分けて表示します。scene pack の生成順は `scenes` 配列順で、Scenes 一覧のドラッグ＆ドロップ並び替えはこの配列順を更新します。`Jump` / `Choice.targetSceneId` / `startScene` は `id` を参照するため、`name` を変更しても遷移先は変わりません。GUI ではヘッダの `ID` で scene `id` を変更でき、`Start` で `startScene` を選べます。`ID` 変更時は `Jump` / `Choice.targetSceneId` / `nextSceneId` / `startScene` の参照を同時に更新し、重複 ID は自動で suffix を付けて回避します。

scene の `fullScreenBg` を `true` にすると、その scene は 256x224 の全画面 BG 専用になります。`background` command は 256x224px の BG asset を `x: 0`, `y: 0` に置く必要があり、`message` / `choice` / 表示中の `sprite` / 表示中の `spritetext` を含めると build error になります。256x224 BG は `tileBase` 次第で message/font/spritetext/sprite pattern 用 VRAM と重なるため、VN build はその BG asset が Full BG 専用のときだけ重なりを許可します（同じ asset を通常 scene の `background` でも使う場合は通常どおり build error）。runtime は Full BG 読み込み後に text/spritetext/blank 用 VRAM と sprite pattern cache を dirty 扱いし、通常 scene へ戻る前または `message` / `choice` / `spritetext` の直前に必要領域を再転送します。runtime も scene pack flag を見てこれらの表示 command を無視するため、前後 scene の UI や sprite が全画面 BG を上書きしません。

VN build が generated `assets.c` / runtime asset index へ出すのは、scene command から参照される BG / sprite / audio asset だけです。未使用の大きな BG や sprite は Asset 一覧には残せますが、VRAM 排他予約、runtime metadata、resident bank128 予算、scene command の index には入りません。未使用 asset を scene から参照した時点で通常のサイズ・VRAM・bank 予算チェック対象になります。

VN build では `src/generated/vn.h` / `vn.c` に `pce_vn_command_t`, `pce_vn_message_t`, `pce_vn_choice_t`, `pce_vn_switch_t`, `pce_vn_sprite_anim_t` を出力します。runtime は command を順に実行し、`message`, `choice`, `wait` command で停止します。`background.x` / `background.y` は32x32 BAT上のタイル座標で、指定した位置へBG mapを配置します。未指定時は通常 BG 向けの `(2, 1)` です。`background.transition` は互換用に `"fade"` を保存し、`fadeOutFrames` / `fadeInFrames` は `10 / 20 / 30 / 40 / 50 / 60` のプリセット値へ正規化されます。未指定時の既定値は速度3の `30` です。`sprite` command は表示・差し替え・非表示を即時反映します。旧 `durationFrames` / `moveFrames` は読み込み時に破棄され、生成には使われません。`-1` sentinel を持つ generated index field は `signed int` とし、件数を `unsigned char` で公開する scene/message/choice/switch/variable/sprite animation/command は build 時に 255 件上限を検証します。メッセージ表示領域は 17 文字 × 4 行（メッセージ窓 208x64px、タイル (3, 19) 起点、1 文字 12×12px・横 12px ピッチ・縦 16px 行ピッチ）で、`message.text` は 17 文字で自動折り返しし、4 行を超えた分は表示しません。12px 横ピッチは 8x8 タイル境界に乗らないため、runtime のグリフコンポジタが各文字を VRAM 上のメッセージ帯へ合成描画します。`speaker` がある場合は `speaker：\ntext` を 1 つの glyph stream として流し込みます。話者行（`speaker：` と改行）は message 先頭で即時表示され、typewriter 速度はその後の本文から適用されます。`text` 内の改行 (`\n`) は強制改行として扱い、build 時に `PCE_VN_GLYPH_NEWLINE`(0xfe) として encode、runtime が次の行へ送ります（フォントグリフは消費しません）。`text` を空文字にするとメッセージ領域をクリアした空ページになります（先頭メッセージのみ、未入力時にプレースホルダ文言で初期化されますが、明示的に空にすると空のまま保持します）。`message.textColor` は本文の文字色で、`#rrggbb` の hex をエディタ側で PCE 表示可能色（各チャンネル 3bit）へスナップし、build 時に 9-bit パレット word（`PCE_VN_MESSAGE_COLOR_NONE`=未指定）として scene pack の message record へ格納します。runtime は message 表示開始時に UI パレット (`VN_UI_PALETTE`=15) の前景色をその色へ書き換え、本文と話者ラベルを着色します。エディタの VN プレビューも同じ `textColor` をメッセージ描画へ反映します。未指定の message と選択肢描画時は既定の白へ戻します（このため message record は 13 byte、`PCE_VN_SCENE_PACK_MESSAGE_SIZE`。mouth slot byte は下位 2bit が slot、上位 6bit が即時表示する先頭 glyph entry 数です）。`settings.messageSpeedFrames` はノベルエンジン全体のメッセージ速度で、`0 / 10 / 20 / 30 / 40 / 50` のプリセット値へ正規化されます。`settings.messageAdvanceMode` は既定 `"button"` で、`"auto"` の場合は `settings.messageAutoWaitFrames` 経過後に次 command へ進みます。個々の `message` command の旧 `textSpeedFrames` / `advanceMode` / `autoWaitFrames` は読み込み時に破棄され、生成には使われません。`voiceAssetId` に ADPCM を指定した場合、**build 時にエディタ側が** 1 文字あたりの表示フレーム（scene pack の `text_speed_frames`）を ADPCM 実再生長に合わせて算出し、再生長が取れない場合だけ `settings.messageSpeedFrames` を fallback として焼き込みます（runtime は焼き込まれた値をフレームタイマで使い、再生長計算は行いません）。再生長は `voiceFrames = round(byteLength * 2 * 60 / 実再生レート)`、表示速度は `round(voiceFrames / 本文描画グリフ数)`。**実再生レートは公称 `sampleRate` ではなく量子化レート `32000 / (16 - code)`**（runtime の `adpcm_rate_code` と一致）を使います。**本文描画グリフ数は話者行と改行を除いた本文の発話文字数**で、runtime も改行で typewriter tick を消費せず即座に次行へ送ります（scene pack の `glyph_count` は話者行と改行込み全エントリ数で別）。

> **ADPCM 再生中の文字送り**: CD/ADPCM の bus contention で VN メインループが重くなるため、現行 runtime は timing 補正ではなく毎フレーム処理コスト削減で同期を保ちます。sprite animation は ADPCM 中も停止せず、slot に cache した animation metadata と既存 SATB layout を使って pattern / attr word だけを差分更新します。ADPCM 再生中という理由で sprite/spritetext refresh を gate しないため、message の mouth animation は音声中も動き続けます。voiced message は ADPCM 開始前に glyph mask を `.ram_bank132` cache へ先読みし、glyph compositor は tile と glyph の交差範囲だけを走査します。active message record も `active_message_state` に保持し、typewriter tick で scene pack decode を繰り返しません。`delay_frame()` は `IO_VDC_STATUS` を同関数内だけで読む inline asm の短い guard 付き polling にして、待ちループの I/O read 数を抑えます。runtime 側で VBlank を数えて文字表示を ADPCM 進捗へ追従させる試みは、**再生中の画面の乱れ・文字が音声後に表示・低速化**の回帰を起こしたため撤去しました（`docs` の方針どおり、ADPCM 周りの runtime 改修は Geargrafx で再生中フレームの画面/VRAM/VDC を必ず確認のこと）。メッセージ中の入力は表示済みテキストを消さずに残りの glyph を連続描画して typewriter 表示を即時完了し（ウェイトスキップ。ADPCM はそのまま継続）、完了後の入力で次ページへ進みます。システム設定の `messageAdvanceMode: "button"` でウェイトスキップ後に次ページへ送ると、まだ再生中の ADPCM は `stop_adpcm_voice()` で終了します。システム設定の `messageAdvanceMode: "auto"` と `messageAutoWaitFrames` の待ち時間経過でも次 command へ進みます。`message.mouthSlot` (0..3) と `message.mouthAnimationId` は口パク（リップシンク）用で、message 表示開始時に指定 sprite slot の animation を切り替えます。動作には前提条件があります: (1) **同一 scene 内でその message より前に `sprite` command が同じ `slot` 番号へ対象 sprite を `visible: true` で配置している**こと、(2) その sprite asset に `mouthAnimationId` と一致する `animationId` の animation（`frameCount > 1`、口を回し続けるなら `loop: true`）が定義されていること。両方を満たすと build 時に `pce_vn_message_t.mouth_animation_index` が解決され、満たさない場合（slot に sprite なし / 一致 animation なし / `mouthAnimationId` 空）は `-1`（口パクなし）になります。runtime は message 開始時にその slot の `animation_index` を切り替え `frame` / `timer` を 0 にリセットして再生を始め、以降は毎フレームの `tick_sprite_animations()` が frame を進めます（`loop` なら回り続けます）。**message 完了時に自動で元の animation へ戻す処理はありません**。喋り終わりで口を閉じたい場合は、その message の後に同じ slot へ idle 用 animation を再適用する `sprite` command を置いてください。`choice` は上下で選択、I/II/RUN で確定し、`variableName` が指定されていれば選択肢の `value` を変数へ代入します。従来互換として各選択肢の `targetSceneId` が指定されている場合は、その scene へ遷移します。`variable` は `define` / `set` / `add` / `sub` / `random` を持ち、値は signed 16-bit へ丸められます。`if` / `switch` / `goto` は同一 scene 内の `label.name` へ command pointer を移動します。`inputcheck` は指定ボタン（`buttons`: `up`/`down`/`left`/`right`/`select`/`run`/`i`/`ii` の OR 条件）の入力で同一 scene 内の `targetLabel` へ GOTO する分岐 command です。`mode` は 3 種: `sync`（条件入力まで同期待機して GOTO）、`async`（待機状態を保持したまま次 command へ進み、以後どのフレームでも条件成立で GOTO）、`cancel`（保持中の非同期待機を終了）。非同期待機は単一ウォッチャで、scene 切替時に自動クリアされます。ボタンマスクは command record の `arg0`、`mode` は `flags`、移動先 label index は `x` に格納します。`audio` の `kind` は `cdda` / `adpcm` / `psg` で、`psg` は `psg-song`（ループ）/ `psg-sfx`（ワンショット）アセットをフレーム駆動シーケンサで再生します。`channel`（0..5）を基準チャンネルとし、パターン各 step の channel をそこからのオフセットとして 0..5 にクランプして発音します（基準チャンネルは command record の `slot` に格納）。`audio` の `action: "stop"` は kind ごとに該当再生を停止します。表示待ちのない無限ループを避けるため、runtime は1回の advance で実行する命令数にガードを置き、超過時は1 frame 待って継続します。明示的な `preload` command は削除済みです。BG/Sprite/ADPCM の自動先読みは scene 入場時の内部 preload が担当し、シナリオ側でロード位置を寄せたい場合は `cache` command の `action: "load"` を使います。 CD-ROM2 VN runtime は CD BIOS graphics driver と System Card の VBlank handler を使わず、VDC 表示制御と SATB 転送を runtime 側で直接管理します。通常 frame wait は `pce_cdb_wait_vblank()` の BIOS counter ではなく VDC status の `VDC_FLAG_VBLANK` を guard 付きで直接待ちます。VDC R5 の `VDC_CONTROL_IRQ_VBLANK` はこの status latch 用に有効化し、HuC6280 側の `IRQ_VDC` は `pce_irq_disable(IRQ_VDC)` で mask します。`PCE_CDB_MASK_VBLANK_NO_BIOS` だけでは System Card の VBlank handler が R5/R7/R8 を毎フレーム書くことがあるため、message 中の BG 水平ずれの原因になります。CD/ADPCM BIOS helper 後は System Card の R5 shadow も runtime が更新するため、sprite enable bit は helper 後も維持されます。SATB の全転送と口パク差分更新は VDC 書き込み直前に `vn_wait_next_vblank()` で VBlank へ寄せ、表示期間中の R19/SATB DMA start を避けます。CD/ADPCM/CD-DA BIOS helper 後の timing/control/scroll 復元と display/sprite layer 切り替えも VBlank 側で行い、表示期間中の R5/R7/R8/R9/R10 書き換えを避けます。CD-DA 再生は explicit な audio command でのみ開始し、asset の track 番号から生成済みの開始 sector を求め、`PCE_CDB_LOCATION_TYPE_SECTOR` と `PCE_CDB_LOCATION_TYPE_UNTIL_END` で `PCE_CDB_CDDA_PLAY_ONE_SHOT` として `pce_cdb_cdda_play()` を呼びます。track 境界は BIOS の明示終了指定ではなく、WAV 長から生成した `play_frames` を runtime が毎 VBlank で減算して管理します。loop 有効時は境界直前で同じ asset の開始 sector へ `pce_cdb_cdda_play()` を再発行し、loop 無効時は `pce_cdb_cdda_pause()` で停止します。CD-DA 停止は `pce_cdb_cdda_pause()` を使います。ADPCM 停止は buffered playback の direct stop を使います。

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
| `pce-music-editor` | ミュージックエディター | `editor`, `asset` | 内部 | `sound-editor` の PSG タブ用モジュール（`新規`＝効果音デザイナーで step pattern を生成 / `取込`＝VGM・MIDI 量子化）。デザイナーの合成ロジックは `psg-sfx-synth.mjs` |
| `pce-background-manager` | 背景管理 | `editor`, `asset` | 内部 | `image-editor` の BG タブ用モジュール |
| `pce-sprite-manager` | スプライト管理 | `editor`, `asset` | 内部 | `image-editor` の Sprites タブ用モジュール |
| `pce-palette-editor` | パレットエディター | `editor`, `asset` | 内部 | `image-editor` の Palette タブ用モジュール |
| `pce-visual-novel-editor` | ビジュアルノベル | `editor`, `asset` | 内部 | `novel-editor` の VN タブ用モジュール |
| `pce-font-editor` | フォント | `editor`, `asset` | 内部 | `novel-editor` の Font タブ用モジュール |

### PCE アセット系

`pce-asset-manager` は `assets/pce-assets.json` v2 を正とする標準アセット管理です。BG image / Sprite sheet / Palette / PSG song/SFX / ADPCM / CD-DA track を扱います。画像の追加は `pce-image-converter` の `image-import-pipeline` を経由し、内蔵 PCE 変換で BG tile / BAT map / sprite pattern 形式の generated asset を作成します。音声の追加は `pce-audio-converter` の共通音声 UI を経由し、project-local WAV を生成してから ADPCM / CD-DA へ登録します。

`image-editor` は BG / Sprites / Palette の画像画面を 1 つの sidebar タブに統合します。画面上部のタブで `BG`、`Sprites`、`Palette` を切り替えます。`pce-background-manager` / `pce-sprite-manager` / `pce-palette-editor` は親 plugin から直接 import される内部 renderer module です。BG / sprite の生成物は内蔵 PCE 変換を使います。BG 追加 UI では出力幅/高さだけを指定し、`paletteBank` / `transparentIndex` は `0` 固定です。Sprites 追加 UI では通常表示を出力幅/高さに絞り、変換時だけ有効な `Cell size` は `アドバンス` に隠します。`paletteBank: 0`、`tileBase: 704`、`x: 144`、`y: 104`、`transparentIndex: 0`、初期 animation `16x16` / `1 frame` / `1 frame delay` で登録します。BG の一覧と詳細 preview の境界はドラッグで幅調整でき、preview はホイールで拡大縮小し、中央ボタンドラッグで表示位置を動かせます。BG の一覧は `Name` と `ID` を別列にし、各列ヘッダーで昇順/降順ソートできます。Image 配下の asset 一覧では `Name` に `folder/item` のような `/` 区切りを使うと、エディタ上ではグループ見出しと leaf 名に分けて表示します。Sprites タブは左に sprite asset tree、中央に frame preview / sprite sheet / Animation Rows、右に properties を表示します。PCE では `assets/pce-assets.json` の sprite asset を正とし、frame size、ROW ごとの有効 frame 数、time、collision などの編集結果は `options.animations` と `options.spriteEditor` metadata へ保存します。

### Sound / Novel 統合 UI

`sound-editor` は ADPCM / CD-DA / PSG の音声画面を 1 つの sidebar タブに統合します。`pce-adpcm-manager` / `pce-cdda-manager` / `pce-music-editor` は `sound-editor/renderer.js` から直接 import される内部 renderer module です。ADPCM / CD-DA の一覧と詳細 pane の境界はドラッグで幅調整できます。一覧行右端の preview / delete は横並びの icon button として扱い、狭い列幅でも縦に崩れないようにします。ADPCM / CD-DA の一覧は `Name` と `ID` を別列にし、各列ヘッダーで昇順/降順ソートできます。Sound 配下の asset 一覧でも `Name` の `/` 区切りをグループ表示として扱います。PSG タブでは `新規` で空の PSG asset を作るほか、`取込` ボタンで既存の VGM / VGZ / MIDI ファイルを選び、step pattern へ量子化して psg-song / psg-sfx asset として登録できます（拡張子で VGM/MIDI を自動判別）。PSG 一覧には `MIDI取込` / `VGM取込` / `エディタSFX` などの作成元タグと、選択 asset を削除する `×` button があり、プレビューは再生/停止のトグル icon button です。MIDI 取込では設定中の `midiOptions` で `assets:previewMidi` を実行し、保存前に変換結果を WebAudio で試聴できます。VGM は HuC6280 PSG レジスタ書き込みを、MIDI は `pce-midi-import.js` がノートを 6 ボイスへ削減し音程→period・ベロシティ→volume・ドラム(10ch)→PSG ノイズ(ch4/5) に近似して変換します。step pattern と生成 C struct (`pce_editor_psg_step_t`) には 16bit step と noise フラグを持たせ、runtime (`psg_set_noise`) が PSG R7 でノイズを鳴らします。共通の量子化ロジックは `pce-psg-quantize.js`、IPC は `assets:importVgm` / `assets:importMidi` / `assets:previewMidi` です。**大きい曲パターン (>256byte) は CD data file (`assets/generated/psg/<id>.bin`) としてストリームし、再生時に `load_psg_pattern_cd()` が RAM bank134+bank135 の 16KB buffer へ読み込みます**（常駐バンクを消費しない・曲数無制限、最大 4096 step / 2048 pattern event、8byte/entry）。CD-ROM2 VN では短い SFX も同じ PSG pattern CD data file と catalog record で扱い、`.rodata` 常駐の即時再生にはしません。再生開始後の PSG sequencer は CD drive を使わないため、BG/sprite/font/scene pack の CD 転送待ち、CD→VRAM 転送、palette fade 中にも runtime が補償 tick で進め、同期ロード中の停止や大きなテンポ低下を抑えます。完全な割り込み駆動ではないため、非常に長い同期処理ではタイミングが粗くなる場合があります。補償値の実機/エミュレータ調整は `docs/pce-memory-bank-strategy.md` の「PSG 補償 tick 調整 TIPS」を参照してください。Asset manager と VN script の Audio command preview も同じ WebAudio PSG 疑似再生を使います。

Sound > ADPCM の詳細フォームと取込ダイアログは、通常編集する ID / Name / Sample rate / Loop / Split だけを表示します。新規取り込みの標準 sample rate は 8000Hz です。Streaming 再生指定は削除済みです。低レベルの `adpcmAddress` と `divider` は UI には出さず、address は既定値、divider は `sampleRate` からの自動値を使います。

`novel-editor` は script scene 編集、システム設定、font 生成を 1 つの sidebar タブに統合します。画面上部のタブは `スクリプト` / `システム設定` / `フォント` です。Scenes 一覧では各行右端の削除アイコンから scene を削除でき、ドラッグ＆ドロップで `scenes` 配列順を並び替えられます。シーン名は編集ヘッダの Name で変更でき、`/` 区切りの名前は Scenes 一覧でグループ表示します。scene `id` は同じヘッダの `ID`、開始シーンは `Start` で編集できます。`pce-visual-novel-editor` / `pce-vn-system-settings` / `pce-font-editor` は `novel-editor/renderer.js` から直接 import される内部 renderer module です。CD-ROM2 / VN runtime の bank 配置を変える作業では、先に `docs/pce-memory-bank-strategy.md` を読んでください。

### Test Play

`pce-standard-emulator` は `pce-setup-manager` が検出した EmulatorJS runtime と `mednafen_pce` core を使います。HuCard / CD-ROM2 の Test Play では、System Card / IPL はユーザー所有ファイルとして扱い、リポジトリへ同梱しません。描画崩れの原因調査は EmulatorJS の見た目だけに依存せず、利用可能なら Geargrafx MCP で VDC / VRAM / SATB / palette を確認してください。

`pce-external-emulator` は `testplay` role の代替 plugin です。Project Settings の `testPlay.externalEmulator.executablePath` と `testPlay.externalEmulator.extraArgs` を読み、`context.testPlay.launchExternalEmulator()` で外部プロセスを起動します。macOS では未設定時の起動パスを `/Applications/Geargrafx.app/Contents/MacOS/geargrafx` に補完します。`.app` bundle が指定された場合は、main process 側で `Contents/MacOS` の実行ファイルへ解決してから ROM / CUE path を渡します。`extraArgs` に `{rom}` / `{romPath}` / `{file}` / `%ROM%` を含めるとその位置へ生成済み ROM / CUE path を挿入し、placeholder が無い場合は末尾へ自動追加します。この設定 UI は Test Play role が `pce-external-emulator` の場合だけ有効です。ユーザー向け手順は `docs/user-guide.md` を参照してください。

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

ROW ごとの有効フレーム数は `spriteEditor.time` 行列と `options.animations[]` に保存します。現行 runtime が直接使う値は `animations[].frameDelays` です。UI 編集後は両者を同期し、preview も各 frame の delay を使います。

Sprite Sheet には cell grid、選択 frame、無効 frame の overlay、各 frame の time 値を重ねて表示します。シートクリックは ROW / frame 選択だけを行い、自動再生は開始しません。Frame Preview / Sprite Sheet の canvas は preview 領域内でスクロールでき、中央ボタンドラッグでも scroll 位置を移動できます。倍率入力は 10-500% の percentage として扱い、mouse wheel で滑らかに変化させます。import が受理する cell size は manifest/UI にある `16x16`、`16x32`、`16x64`、`32x16`、`32x32`、`32x64` です。最終的な pattern VRAM / SATB 境界は build 時に検査されます。

Asset Manager の右列 preview でも SPRITE はシートそのものではなく、選択 ROW の animation を表示します。再生 / 停止は icon button にし、animation select の表示は `1 (4 frames)` のように簡潔にします。

### BMP / PNG palette の扱い

PCE 用 indexed 画像を単に canvas へ描いて `canvas.toDataURL('image/png')` すると indexed palette が失われ、実際に使われている色だけで RGBA PNG へ再構成されます。未使用 palette、特に BMP の palette index 0 を保持したい場合、この経路を通してはいけません。

安全な方針:

- indexed PNG は `PLTE` / `tRNS` / `IDAT` を直接読んで palette と index を扱う
- indexed BMP は BMP ヘッダー、カラーテーブル、ピクセル index を直接読む
- BMP を PNG 化する場合は、BMP の index 0 を PNG palette index 0 に固定する
- 8bit BMP のようにカラーテーブルが256色でも、実使用 index が16色以内なら、使用 index だけを16色以内に remap して indexed PNG として保存できる
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
