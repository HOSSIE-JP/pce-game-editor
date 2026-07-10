# 実装・文書整合性監査（2026-07-10）

## 結論

実装を正として、PCE専用アプリの現行経路に存在しないMega Drive / SGDK / ResComp / `md-api`のUI、IPC、preload API、manager、テストを撤去しました。現行テンプレート、asset schema、plugin manifest、Test Play、AI controlの説明とテストも実装へ合わせています。

現行仕様は次のとおりです。

- coreは`pc-engine`のみ。
- HuCardは`targetMedia: "hucard"`、Super CD-ROM2は`targetMedia: "cd"`と`toolchain: "llvm-mos"`。
- assetの正本は`assets/pce-assets.json`、VN sceneの正本は`assets/pce-vn-scenes.json`。
- visual payloadはrawの`tiles.bin` / `map_vram.bin` / `patterns.bin`のみ。
- build / Test Play pluginは`project.json.pluginRoles.builder` / `pluginRoles.testplay`で選択する。
- plugin manifestは`id`、`name`、`version`、`types`、`supportedCores`を必須とする。

## 修正した不一致

### テストと旧surface

- 存在しないsetup / ResComp /旧Test Play APIのテストを削除し、現行PCE IPC・plugin・asset・Test Play契約のテストへ更新。
- `setup-manager.js`、`rescomp-manager.js`、`debug-preload.js`、旧debug HTMLを削除。
- `main.js` / `preload.js` / rendererから`md-api`、旧API emulator、`res:*`、SGDK系setup、汎用core選択を削除。
- setup画面をllvm-mos、EmulatorJS、ユーザー所有IPL / System CardのPCE専用構成へ整理。

### テンプレートとschema

- `template_pce_sample`と`template_pce_vn_cd`を現行converterで再生成。
- `.rle` sidecar、圧縮generated metadata、存在しない旧asset directory、古い`cd.dataFiles`参照を削除。
- generated dataとsprite editor metadataは現行fieldのwhitelistで正規化し、旧圧縮field名をproduct codeから除去。
- Image / VN pluginの表示とcache見積りもraw fileだけを参照する。

### plugin契約

- manifestの必須field、folderと`id`の一致、PCE core宣言を検証する。
- dependency不足時はenabled stateを部分変更せず失敗する。
- builderの`onBuildStart`が失敗した場合はbuild本体を開始しない。
- 実装に存在しない公開`manifestVersion`や旧runtime呼称を文書から削除。

## 追加課題1〜4への対応

### 1. PCE smoke test

`tests/pce-app-separation.test.js`に、現行3テンプレートを実際のproject作成APIで複製し、設定保存、dry build、標準Test Play pluginへのhandoffまで行うsmoke testを追加しました。

- `template_pce_sample`: HuCard `.pce`
- `template_pce_vn_cd`: Super CD-ROM2 `.cue`
- `template_pce_vn_hucard`: HuCard VN `.pce`

3件とも作成、`project.json`保存、asset/VN source生成、build command構成、`pce-standard-emulator.onTestPlay()`のhost API呼び出しまで通過します。

Electron画面の自動操作は、Windows操作runtimeがホストの`AppData`を`lstat`できず起動しなかったため未実施です。GUIとは独立したproject/build/Test Play境界は自動化しましたが、画面上のImage / Sprites / Sound / Novel操作と実際のEmulatorJS window表示は手動確認項目として残ります。

### 2. エラー診断

- `app-diagnostics.js`に最大200件の診断bufferと購読APIを追加。
- main processの診断を`app-diagnostic` IPCでrendererへ送り、既存log viewerへ表示。
- 起動前に発生した診断も`diagnostics:list`からrenderer初期化時に回収。
- project config読込、project migration、plugin state読込、plugin role保存、export metadata、macOS外部emulator探索の失敗をcode付きで通知。
- rendererのplugin一覧、role復元、enabled state復元の失敗をlog viewerへ通知。
- 残る空catchはwindow menu cleanup、候補file探索、localStorage、audio teardownなど、失敗しても操作を止めないbest-effort処理だけ。

### 3. plugin診断と信頼モデル

- Settings > Pluginsにmanifest parse/validation errorと不足dependencyを表示する診断欄を追加。
- 不正なuser pluginが同じIDの有効なbuilt-in pluginを隠さないscan規則へ変更。
- 新しいuser pluginは未信頼・無効状態とし、有効化時にrenderer/main codeの実行確認を表示。
- 信頼後だけrenderer asset、hook、generatorを実行できる。
- 「信頼を解除」でpluginを無効化し、実行許可を取り消す。

現在は明示確認方式です。信頼した`index.js`はmain processでNode.jsとfilesystemへアクセスでき、別process sandboxへは隔離していません。

### 4. 責務分割

次の境界を独立moduleへ移しました。

- main plugin IPC: `plugin-ipc.js`
- application diagnostics: `app-diagnostics.js`
- renderer project/Test Play settings: `renderer/project-settings.mjs`
- renderer plugin diagnostics/trust文言: `renderer/plugin-diagnostics.mjs`
- asset document CRUD: `pce-asset-store.js`
- PNG decode: `pce-png-decoder.js`
- asset schema: `pce-asset-schema.js`
- asset IPC: `pce-asset-ipc.js`
- VN CD catalog収集: `pce-vn-cd-catalog.js`
- VN CD merge policy: `pce-vn-cd-data-files.js`
- VN scene pack binary codec: `pce-vn-scene-pack.js`
- Test Play settings: `pce-testplay-settings.js`

抽出後も`main.js`は約2,066行、`renderer/renderer.js`は約6,701行、`pce-asset-manager.js`は約3,529行、`pce-vn-manager.js`は約4,514行です。行数だけを減らす分割はせず、I/O、永続状態、binary codec、IPCの所有境界を先に分離しました。

## 検証結果

- `npm test`: 256 tests、255 pass、1 skip、0 fail。
- skipはWindowsで権限なしにsymlinkを作れない環境向けのpath escape test。
- 3テンプレートsmoke test、template asset生成、HuCard / CD-ROM2 source generation、build dry-run、IPC traversal rejection、plugin trust/diagnostics、Test Play serverを含む。

## 残る課題

1. Electron GUI上で3テンプレートのImage / Sprites / Sound / Novel保存と、標準/外部Test Play windowを手動確認する。
2. 未信頼pluginを配布・自動取得する要件が生じた場合は、明示信頼だけでなくprocess分離・署名・権限sandboxを設計する。
3. `main.js`のwindow/build IPC、rendererのproject/converter controller、asset managerのaudio/source emitter、VN managerのscene/font/build orchestrationを同じ所有境界でさらに分割する。
4. ADPCM divider/encoderと一部VN command fieldに残る値補正は、実データ利用状況と再生成手段を確認してから削除判断する。
5. Geargrafxと標準EmulatorJS/WASMでBG、sprite、PSG、ADPCM、joypad edgeを実動作確認する。
