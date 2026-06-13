# refactor-instructions.md — pce-game-editor リファクタリング指示書

このファイルは実装担当モデル(Codex / Opus 等)向けの作業指示書である。
作業前に必ず `AGENTS.md` を読み、本書と矛盾する場合は `AGENTS.md` と人間の指示を優先すること。

---

## 1. Objective

PCE 専用リポジトリに残存する Mega Drive (md-game-editor) 由来のレガシーコード・死コード・重複を、既存の PCE 向け挙動を一切壊さずに段階的に除去し、テストの実態と `npm test` を一致させ、今後の変更を安全にする。

目的ではないこと: 見た目の綺麗さのための整形、全面書き換え、アーキテクチャの刷新。

## 2. Project Understanding

### 概要

- Electron ベースの PC Engine / Super CD-ROM2 ゲームエディター。`md_emulator/pce-game-editor` から分離した PCE 専用版 (README.md)。
- HuCard / CD-ROM2 のビルド (llvm-mos)、PCE アセットパイプライン、Test Play (EmulatorJS / mednafen_pce)、ビジュアルノベル(VN)ランタイム生成、プラグイン機構、外部 AI ツール用の AI Control API (REST/MCP, localhost のみ) を持つ。

### エントリーポイント

- `main.js` (3,491 行) — Electron main process。約 98 個の IPC ハンドラ、ウィンドウ管理、Test Play 用ローカル静的 HTTP サーバー、エクスポート、AI Control 起動を一手に持つ。
- `renderer/renderer.js` (8,896 行) — renderer の単一巨大ファイル。タブ UI、ビルドログ、プラグインホスト、アセット UI ほぼ全て。
- `preload.js` — contextBridge で `electronAPI` を公開。
- `scripts/start-electron.js` — `npm start`。起動前に `inject-build-meta.js` を実行。

### 主要モジュールと責務

| ファイル | 責務 |
|---|---|
| `core-manager.js` | core (mega-drive / pc-engine) ルーター。`app.config.js` の `allowedCoreIds: ['pc-engine']` により実行時は PCE のみ有効 |
| `pce-build-system.js` | PCE プロジェクト管理・ビルド (llvm-mos) |
| `pce-asset-manager.js` (2,329 行) | アセット文書 I/O、PNG デコード、内蔵 PCE 画像変換、ADPCM/CDDA、CD データレイアウト、ソース生成 |
| `pce-vn-manager.js` (2,058 行) | VN シーン schema 正規化、レガシー形式の読み替え、フォント/グリフ encode、VN ソース生成 |
| `pce-audio-converter.js` | WAV→ADPCM 変換。`sampleRateToAdpcmDivider` 等の rate code 規約を持つ |
| `pce-setup-manager.js` | toolchain / EmulatorJS / System Card のセットアップ状態 |
| `pce-cd-bundle.js` | CD-ROM2 ISO/cue バンドル |
| `pce-ipl-extractor.js` | ユーザー所有ファイルからの IPL 抽出 |
| `pce-project-migration.js` | 旧リポジトリからの PCE プロジェクト移行 (PCE 固有。共通ライブラリへ戻さない — AGENTS.md) |
| `pce-file-safety.js` | パストラバーサル防止の正規実装 (`isPathInside` / `resolveUnderRoot`) |
| `plugin-manager.js` | `plugins/` の manifest 読込・role 管理 |
| `editor-control-service.js` | AI Control API (REST + MCP)。token 認証、localhost 限定、mutate 系は dryRun/confirm 必須 |
| `build-system.js` / `setup-manager.js` / `rescomp-manager.js` | **MD レガシー**。core-manager 経由でのみ参照。実行時には到達しない |
| `plugins/` | PCE 系プラグイン群 + `pc-engine-core`。manifest.json + renderer.js が基本形 |
| `template/` | `template_pce_sample` (HuCard) / `template_pce_vn_cd` (CD) |

### データフロー

renderer → preload (`electronAPI`) → `ipcMain.handle` (main.js) → core-manager → pce-build-system / pce-asset-manager / pce-vn-manager → プロジェクトディレクトリ (`project.json`, アセット文書, 生成ソース) → llvm-mos ビルド → ROM/ISO → Test Play (main.js 内の静的サーバー + EmulatorJS)。
AI Control は外部ツール → REST (127.0.0.1:17777) → editor-control-service → main.js が登録した command 実装、という別経路で同じ操作に到達する。

### 外部依存

- `game-editor-common` — **隣接リポジトリ** `../game-editor-common` を `file:` 参照。npm install 済みの symlink。**このリポジトリの作業で game-editor-common を変更しないこと。**
- `iconv-lite`、Electron 41、electron-builder。
- 実行時のみ: llvm-mos-sdk、EmulatorJS、System Card (すべてユーザー所有。リポジトリ非同梱 — AGENTS.md)。

### 検証コマンド

- `npm test` — `tests/run-tests.js`。**現在は 30 個中 6 個のテストファイルしか実行していない** (pce-app-separation, pce-asset-manager, pce-cd-bundle, pce-setup-manager, pce-standard-emulator, pce-vn-manager)。
- `npm start` — 手動起動確認。
- `node scripts/smoke-pce-cd-testplay.js` — CD Test Play の手動スモーク。
- lint / typecheck / CI は存在しない。

## 3. Behaviors To Preserve (絶対に壊さないこと)

1. PCE プロジェクトの作成・オープン・ビルド・Test Play・ROM エクスポートの全フロー (HuCard / CD 両方)。
2. `project.json` の schema と既存プロジェクトの読み込み互換性。レガシー VN シーン形式の読み替え (`pce-vn-manager.js` の normalizeLegacy* 系)。
3. ADPCM 規約 (AGENTS.md): `divider` は rate code (`32000/(16-code)` 近似)、旧値の読み込み時補正、preload 後も `pce_cdb_adpcm_play()` 必須、1 asset 上限 `min(65535, 65536 - adpcmAddress)`。
4. CD-ROM2 メモリバンク配置: bank129=実行コード、bank132=VN data、bank130-131=小さい fallback のみ。大きい payload は `cd.dataFiles`。
5. VN BG `map_vram.bin` は 64 タイル幅ソース行として行単位 BAT 転送。`mapBase` 一括転送へ変えない。sprite の `pce_editor_sprite_draw_meta[]` compact metadata と `VN_VDC_MEMORY_CONTROL` の扱い。
6. パストラバーサル防止: ファイルシステム IPC・AI Control・静的サーバーはプロジェクトルート/許可ルート外へのアクセスを拒否し続けること (symlink 解決込み)。
7. AI Control のセキュリティ特性: 127.0.0.1 bind、Bearer token、Origin チェック、mutate 系 tool の dryRun/confirm 要求、payload redaction 付きログ。
8. プラグイン manifest 仕様・IPC API・renderer host API (PLUGIN.md に記載のもの)。
9. `pce-project-migration.js` の移行挙動 (PCE プロジェクトのみコピー、既存フォルダを上書きしない、再実行は skip)。
10. テンプレート 2 種 (`template_pce_sample`, `template_pce_vn_cd`) からのプロジェクト生成。

## 4. Non-Negotiables (作業ルール)

- 最初に `git status` を確認する。未コミット変更がある場合は人間に報告し、自分の変更と混ぜない。
- 編集前に baseline として `npm test` を実行し結果を記録する (`../game-editor-common` が必要。無ければ停止して報告)。
- 変更は小さく戻しやすい単位にし、フェーズごとにコミットする。コミットメッセージは日本語 (AGENTS.md)。
- 無関係な整形・ついでのリファクタリングをしない。`catch (_) {}` の一括置換のような横断的な書き換えをしない。
- 既存挙動を勝手に変えない。削除は本書で明示されたものに限る。
- 外部リポジトリからコードをコピーしない (AGENTS.md)。
- 公開 API・プラグイン manifest・IPC・ビルド仕様を変えた場合は、同じ作業内で `PLUGIN.md` / `AI_CONTROL.md` / `docs/` を更新する (AGENTS.md)。
- `../game-editor-common` は読み取り参照のみ。変更しない。

## 5. Stop And Ask Conditions (停止して人間に質問する条件)

以下に該当したら実装を止め、状況と選択肢を提示して指示を待つこと。

1. テストと実装が矛盾している (本書の想定と異なる失敗をする) 場合。
2. 削除対象ファイルが、本書に書かれていない場所から参照されていると判明した場合。
3. `project.json`・アセット文書・VN シーン文書など保存済みデータの schema に影響しそうな場合。
4. AI Control の tool 一覧・引数・レスポンス形式を、本書で承認された範囲 (export_html / api 系 / 命名) を超えて変える必要が出た場合。
5. `api:startServer` 系の扱い (Phase 6 参照) — md-api の PCE 代替が存在しないため、削除か再設計かは人間の判断が要る。
6. export_html の PCE 再実装 (Phase 7) で、EmulatorJS の同梱・ライセンス・配布形態に関わる設計判断が必要になった時点 (実装前に設計案を提示して承認を得る)。
7. ビルド成果物 (ROM/ISO) のバイナリ差分が出る変更になりそうな場合。
8. `game-editor-common` 側の修正が必要だと判明した場合。

## 6. Baseline Commands

```sh
git status
npm test                                # 全 6 suite が pass することを記録
npm start                               # 起動し、プロジェクト一覧表示まで目視確認 (可能なら)
```

`npm test` が環境要因 (../game-editor-common 不在等) で実行できない場合は、その理由を記録し、人間に報告してから作業可否の判断を仰ぐこと。

## 7. Debt Map

凡例 — 実装可否: ✅ 本書の承認で実装してよい / 🟡 提案のみ (レポートに記載し承認を待つ)

### D1. MD レガシーコア一式 ✅ (人間承認済み: 段階的に削除)

- 根拠: `build-system.js` (1,138 行)・`setup-manager.js` (1,527 行)・`rescomp-manager.js` (616 行) は `core-manager.js` からのみ require され、`app.config.js` の `allowedCoreIds: ['pc-engine']` により MD 分岐は実行時に到達しない。
- なぜ負債か: PCE 専用リポジトリに 3,000 行超の到達不能コードがあり、core-manager の全関数が二重分岐を持つ。
- 影響範囲: `core-manager.js`、`main.js` (`getMdSetupManager` 等)、`tests/pce-app-separation.test.js` (loadCoreManager が `../build-system`・`../setup-manager` の require cache を削除している)、`electron-builder.yml` (`*.js` で同梱)。
- リスク: 中。core-manager の分岐除去で挙動が変わると全機能に波及。
- 改善案: Phase 4 参照。core-manager を PCE 直結に単純化 → MD モジュール削除。
- 検証: `npm test` 全 pass、`npm start` でプロジェクト作成/オープン/ビルド/Test Play を確認。

### D2. md-game-editor 時代の遺物ファイル ✅ (人間承認済み: 削除)

- 根拠:
  - `md-emulator.js` (662 行)・`md-emulator.d.ts`・`stage-data-manager.js`・`block-stage-exporter.js` — リポジトリ内のどの実行コードからも require されない (tests の孤児ファイルからのみ参照)。
  - `wasm-player.js` (1,048 行) — `main.js` の export_html 経路 (D6) からのみ参照。
  - `plugins/standard-emulator/` — manifest.json が無く plugin-manager に載らない。`tests/pce-app-separation.test.js` も「存在しないこと」を期待 (manifest 不在で現状 pass)。
  - `plugins/pce-sprite-editor/` — 空ディレクトリ。どこからも参照されない。
- リスク: 小。ただし削除順は D6 (export_html) の後にすること (wasm-player.js / standard-emulator は export_html 旧実装の依存)。
- 検証: 削除後に `grep -rn "<ファイル名>"` で参照ゼロを確認 → `npm test` → `npm start`。

### D3. テストの実態と `npm test` の乖離 ✅

- 根拠: `tests/` に 30 個の `.test.js` があるが `tests/run-tests.js` は 6 個のみ実行。孤児テストのうち `block-plugins` / `dungeon-plugins` / `rhythm-plugins` / `asset-checker-plugin` / `md-bgm-composer` / `midi-converter` / `slideshow-plugin` / `tilemap-editor` / `vgm-preview-player` / `plugin-renderer-utils` 等は存在しないプラグイン (`plugins/block-game-builder` ほか) を参照しており実行不能。一方 `editor-control-service.test.js` / `pce-ipl-extractor.test.js` / `plugin-manager.test.js` / `preload.test.js` / `packaging-config.test.js` / `main-window-state.test.js` 等は実在モジュールを対象にしているのに実行されていない。
- なぜ負債か: 安全網が見かけより薄い。AI Control (セキュリティ境界) のテストが回っていない。
- 改善案: Phase 2 参照。生きているテストを runner に追加し、MD 遺物のテストを削除。
- リスク: 小〜中 (追加したテストが現状の実装で fail する可能性がある。fail した場合は Stop And Ask 条件 1)。

### D4. パス安全性ロジックの重複 ✅

- 根拠: `pce-file-safety.js` が正規実装だが、`main.js:1025` (`isPathInside`/`findExistingAncestor`/`resolveUnderCodeRoot`)、`main.js:719` (`resolveStaticPath`)、`setup-manager.js:1416`、`pce-cd-bundle.js:107` に同種ロジックが重複。利用しているのは `pce-asset-manager.js` のみ。
- なぜ負債か: セキュリティ境界の実装が分散し、修正漏れの温床。実際 `main.js` 版 `isPathInside` は `path.resolve` を呼ばない点で `pce-file-safety.js` 版と微妙に異なる。
- 改善案: Phase 5 参照。`pce-file-safety.js` へ集約。ただし**先に挙動を固定するテストを書く**こと。
- リスク: 中 (path traversal 防御の挙動変化は脆弱性に直結)。
- 検証: 新設するパス安全性テスト (相対 `..`、絶対パス、symlink 脱出、存在しないパス) + `npm test`。

### D5. main.js / renderer.js の巨大化 🟡 (分割は提案のみ。Phase 5 の小規模抽出を除く)

- 根拠: `main.js` 3,491 行・98 IPC ハンドラ・静的 HTTP サーバー内蔵。`renderer/renderer.js` 8,896 行・387 関数。さらに `scripts/smoke-pce-cd-testplay.js` が `resolvePceEmulatorJsRuntime` / `contentTypeForFile` / 静的サーバーを main.js からコピーして保持 (二重実装)。
- なぜ負債か: 変更影響の見積りが困難。smoke script と本体の挙動乖離が起きうる。
- 改善案: 今回実装してよいのは「Test Play 静的サーバー + ランタイム解決」を `pce-testplay-server.js` (新規) に抽出し、main.js と smoke script の双方から使う部分まで (Phase 5)。renderer.js の分割と main.js の全面分割は構成案をレポートで提案するに留める。
- リスク: 中。Test Play は実機検証が難しいため、smoke script と手動確認を必須とする。

### D6. MD 専用機能の IPC: `export:html` ✅ (人間承認済み: PCE 対応に作り直す)

- 根拠: `main.js:3189 handleExportHtml` は `plugins/standard-emulator/pkg/md_wasm.js` 等 MD 用 wasm プレイヤー前提で、ROM 拡張子も `.bin|.md|.gen|.smd`。PCE では成立しない。AI Control の `export_html` tool (editor-control-service.js:67, main.js:1343) からも呼ばれる。
- 改善案: Phase 7 参照。**設計提案 → 人間承認 → 実装** の順。IPC 名 (`export:html`) と AI Control tool 名 (`export_html`) は維持する。
- リスク: 大 (新規機能実装に近い)。承認前に旧実装を削除しないこと。

### D7. MD 専用機能の IPC: `api:startServer` 系 🟡 (Stop And Ask)

- 根拠: `main.js:1566 resolveApiLaunch` は `cargo run -p md-api` または `standard-api-emulator` プラグイン (本リポジトリに存在しない) のバイナリを起動する。PCE 環境では必ず失敗する。
- 改善案: PCE 代替が存在しないため勝手に決めない。「削除」「PCE 用 API サーバーとして再設計」の 2 案をレポートで提示し、人間の判断を待つ (Stop And Ask 条件 5)。それまで実装は変更しない。

### D8. AI Control の MD 命名 ✅ (人間承認済み: 破壊的変更可)

- 根拠: `editor-control-service.js` のリソース URI `md-editor://`、説明文「MD Game Editor」「ResComp」、`scripts/md-game-editor-mcp.js`、環境変数 `MD_EDITOR_CONTROL_URL` / `MD_EDITOR_CONTROL_TOKEN`、`AI_CONTROL.md` の記載。
- 改善案: Phase 6 参照。`pce-editor://`・`PCE_EDITOR_*`・`pce-game-editor-mcp.js` へ改名し、ドキュメントとテストを同時更新。breaking change としてレポートに明記。
- リスク: 中 (外部ツール設定が壊れる。承認済みだが必ず報告に含める)。

### D9. PLUGIN.md のドキュメント乖離 ✅

- 根拠: PLUGIN.md「既存プラグイン一覧」に `slideshow` / `asset-manager` (Rescomp) / `sprite-editor` / `tilemap-editor` / `audio-converter` / `midi-converter` / `md-bgm-composer` / `rhythm-game-editor` 等、本リポジトリに存在しないプラグインの節がある。
- 改善案: Phase 3 で `plugins/` の実態に合わせて一覧を更新。仕様節 (manifest / hook / IPC) は挙動の変更をしない限り触らない。
- リスク: 小 (ドキュメントのみ)。

### D10. エラーの握り潰し 🟡

- 根拠: `catch (_) {}` が main.js に 21 箇所、renderer.js に 28 箇所など。
- 改善案: 一括変更は禁止。Phase 中に触ったコードパスに限り、無視してよい理由をコメントするか debug ログを足す。全体方針はレポートで提案のみ。

## 8. Implementation Phases

各フェーズの末尾で「検証 → コミット」を行う。フェーズ途中で Stop And Ask 条件に該当したら停止。

### Phase 0 — 現状確認 (変更なし)

1. `git status` / `git log --oneline -5` を記録。未コミット変更があれば報告して停止。
2. `npm test` を実行し、全 suite の結果を baseline として記録。
3. 可能なら `npm start` で起動確認 (不可ならその旨を記録)。

### Phase 1 — 安全網の追加 (挙動変更なし)

1. `tests/run-tests.js` 未登録のうち実在モジュール対象のテストを 1 ファイルずつ単体実行して triage する: `editor-control-service.test.js`, `pce-ipl-extractor.test.js`, `plugin-manager.test.js`, `preload.test.js`, `packaging-config.test.js`, `main-window-state.test.js`, `export-html.test.js`, `renderer-ui.test.js`, `testplay-plugins.test.js`。
2. pass するものを `run-tests.js` に追加。fail するものは原因を記録し、**実装を直さず** Stop And Ask (条件 1)。MD モジュール対象 (`build-system.test.js`, `setup-manager.test.js`, `rescomp-manager.test.js`, `core-manager.test.js`) はこの段階では追加しない (Phase 4 で削除予定)。
3. パス安全性の現挙動を固定するテスト `tests/pce-file-safety.test.js` を新設 (相対 `..`、絶対パス、symlink 脱出、未存在パス、`main.js` 相当の入力ケース)。

### Phase 2 — 明らかに安全な削除 (実行されないテスト・空ディレクトリ)

1. 存在しないプラグインを参照する孤児テストを削除: `asset-checker-plugin`, `block-plugins`, `dungeon-plugins`, `rhythm-plugins`, `md-bgm-composer`, `midi-converter`, `slideshow-plugin`, `tilemap-editor`, `vgm-preview-player`, `plugin-renderer-utils` (削除前に各ファイルの参照先が本当に存在しないことを確認)。
2. `plugins/pce-sprite-editor/` (空) を削除。
3. `stage-data-manager.js`・`block-stage-exporter.js`・`md-emulator.js`・`md-emulator.d.ts` を削除 (事前に `grep -rn` で参照ゼロ確認。`plugins/standard-emulator` 配下の同名コピーは Phase 7 完了まで残す)。
4. 検証: `npm test` が baseline + Phase 1 追加分すべて pass。

### Phase 3 — ドキュメント同期

1. PLUGIN.md の「既存プラグイン一覧」を `plugins/` の実態 (manifest.json を持つ 19 個) に合わせる。
2. README.md / AI_CONTROL.md の記述で既に実態と異なる箇所 (削除済みファイルへの言及等) を修正。
3. 検証: `npm test` (pce-app-separation がドキュメント参照を含まないことを確認済みだが念のため)。

### Phase 4 — MD コアの段階的削除

順番を守ること。各ステップでテストと起動確認。

1. `tests/pce-app-separation.test.js` の `loadCoreManager` から `../build-system`・`../setup-manager` の require cache 削除行を外す準備をする (このテストは削除後も pass する形に更新)。
2. `core-manager.js` から MD 分岐を除去し、PCE 直結に単純化する (`mdBuildSystem` / `mdSetupManager` / `mdRescompManager` への参照、`CORES` の mega-drive エントリ、`listProjects` の MD 合成、`createProject*` の MD 経路、`getMdSetupManager`)。**公開している関数名と戻り値の形は変えない** (main.js / editor-control-service が依存)。
3. `main.js` から `getMdSetupManager` 等 MD 専用参照を除去。
4. `build-system.js`・`setup-manager.js`・`rescomp-manager.js` を削除し、対応する孤児テスト (`build-system.test.js`, `setup-manager.test.js`, `rescomp-manager.test.js`, `core-manager.test.js`) を削除または PCE 前提に書き換え。
5. 検証: `npm test` 全 pass + `npm start` で「プロジェクト一覧 / 新規作成 (両テンプレート) / オープン / ビルド (dryRun 可) / Test Play」を確認。`coreId: 'mega-drive'` の project.json を読んだ場合の挙動が現状 (一覧から除外) と変わらないこと。

### Phase 5 — 重複の集約 (小さな責務分離)

1. `main.js` の `isPathInside` / `findExistingAncestor` / `resolveUnderCodeRoot` を `pce-file-safety.js` の利用に置換 (Phase 1 のテストで挙動固定済みであること)。`pce-cd-bundle.js` の `isPathInside` も同様。
2. Test Play 静的サーバーとランタイム解決 (`resolvePceEmulatorJsRuntime`, `contentTypeForFile`, `resolveStaticPath`, サーバー本体) を新規 `pce-testplay-server.js` に抽出し、`main.js` と `scripts/smoke-pce-cd-testplay.js` の双方から require する。挙動 (URL 経路 `/rom/` `/bios/` `/emulatorjs/` `/emulatorjs-data/`、CORS ヘッダ、ポート探索 18730+) は変えない。
3. 検証: `npm test` + `node scripts/smoke-pce-cd-testplay.js` + 手動 Test Play (HuCard / CD 各 1 回)。

### Phase 6 — AI Control の PCE 命名へ移行 (承認済み breaking change)

1. `md-editor://` → `pce-editor://`、`MD_EDITOR_CONTROL_URL/TOKEN` → `PCE_EDITOR_CONTROL_URL/TOKEN`、`scripts/md-game-editor-mcp.js` → `scripts/pce-game-editor-mcp.js` (package.json の `mcp` script も更新)、説明文の「MD Game Editor」「ResComp」を PCE の実態に修正。
2. `AI_CONTROL.md` と `editor-control-service.test.js` を同時更新。
3. `api:startServer` 系 (D7) はここで**変更せず**、レポートに削除案/再設計案を記載して人間の判断を仰ぐ。
4. 検証: `npm test` (editor-control-service.test 含む) + 手動で AI Control を起動し `GET /v1/status` `GET /v1/tools` `POST /v1/resources/read` を確認。

### Phase 7 — export_html の PCE 再実装 (設計承認後のみ実装)

1. まず設計案を提示: EmulatorJS ベースのエクスポート形態 (単一 HTML が可能か、ランタイム同梱の可否・ライセンス、System Card の扱い = ユーザー所有のため同梱不可)。**承認が出るまで実装しない** (Stop And Ask 条件 6)。
2. 承認後: `handleExportHtml` を置換し、IPC 名 `export:html` / AI Control tool 名 `export_html` は維持。`export-html.test.js` を新仕様に更新。
3. その後に旧実装の依存 (`wasm-player.js`, `plugins/standard-emulator/`) を削除。
4. 検証: エクスポートした HTML がブラウザで起動すること (System Card 不要の HuCard ROM で確認)。

### Phase 8 — 提案レポート (実装しない)

renderer.js (8,896 行) の分割案、main.js の IPC モジュール分割案、`catch (_) {}` の方針、pce-asset-manager / pce-vn-manager の内部分割案を、根拠・移行手順・リスク付きでレポートにまとめる。実装はしない。

## 9. Verification Requirements

- 各フェーズ末で `npm test` を実行し、結果 (suite 名と pass/fail) を記録する。baseline で pass していたものが fail したら、その場で原因究明し、解決できなければ revert して報告。
- Phase 4 以降は `npm start` での手動確認項目 (プロジェクト作成/オープン/ビルド/Test Play) を必ず実施。GUI 起動不能な環境なら、その旨と未検証リスクを報告に明記。
- 削除を伴うコミットの前に、削除対象シンボルを `grep -rn` (node_modules / data / .git 除外) で参照ゼロ確認する。
- ビルド成果物 (ROM/ISO) に影響しうる変更 (pce-asset-manager / pce-vn-manager / template) は本書のスコープ外。触れた場合は生成物のバイナリ一致確認が必要 (基本的には触らないこと)。

## 10. Reporting Format

最終報告には以下を含めること。

1. 実行したフェーズと、フェーズごとのコミット hash・1 行要約。
2. baseline と最終の `npm test` 結果 (実行した suite 一覧と pass/fail)。最後に実行したコマンドとその出力要約。
3. 削除したファイル一覧と、それぞれの参照ゼロ確認方法。
4. 実施できなかった検証 (GUI 手動確認など) と残存リスク。
5. Stop And Ask で停止した項目と、人間の回答待ちの質問一覧 (特に D7 `api:*` の扱い、Phase 7 の設計承認)。
6. Phase 8 の提案レポート。
7. breaking change の明示 (D8 の命名変更で外部ツール設定の更新が必要になる旨)。

## 11. Out-of-scope Items

- `game-editor-common` (隣接リポジトリ) の変更。
- renderer.js / main.js の全面分割 (Phase 8 で提案のみ)。
- pce-asset-manager / pce-vn-manager の内部リアーキテクチャ、生成される C ソース・バイナリレイアウトの変更。
- VN runtime・メモリバンク戦略・ADPCM 変換規約の変更。
- 新機能追加 (Phase 7 の export_html 再実装は唯一の例外で、承認後のみ)。
- UI デザイン変更、依存パッケージの更新、Electron バージョン更新。
- `data/`・`projects/` 配下 (ユーザーデータ) への変更。
- lint / CI の新規導入 (提案はレポートに書いてよいが実装しない)。
