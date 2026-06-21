# アセットメタ情報の CD オンデマンド化 — Codex 引き継ぎ

作成: 2026-06-21 / 調査・実装: Claude Code（Opus, Geargrafx + `--print-memory-usage` で実測）
関連: [pce-asset-meta-cd-ondemand.md](pce-asset-meta-cd-ondemand.md), [pce-memory-bank-strategy.md](pce-memory-bank-strategy.md),
[pce-vn-overlay-pathb.md](pce-vn-overlay-pathb.md), [pce-cd-bank-overflow-codex-handoff.md](pce-cd-bank-overflow-codex-handoff.md)

このドキュメントは、ここまでに実装・確定した内容と、**まだ解けていない課題と対応案**を Codex へ引き継ぐためのものです。
ユーザーが直接 Codex に指示します。

---

## 0. 出発点の課題（ユーザー要望）

> VN プロジェクトで画像/スプライトのアセット登録を増やすと、ビルド時に `ld.lld` が
> `ram_bank128/129/130/132` を溢れさせる。CD-ROM なのに TOC を読むためのメタ情報で RAM が
> 溢れるのは本末転倒。**メタ情報自体を CD に分散しオンデマンド化**して解決したい。

---

## 1. 確定した事実（ここが一番重要 / 設計の土台）

pce-cd リンカスクリプト（`data/tools/llvm-mos-sdk/.../pce-cd/lib/cd-ram-banked-sections.ld`,
`cd-sections.ld`）と Geargrafx `--print-memory-usage` 実測で確定:

| 区分 | 配置先 | アセット増で増えるか |
|---|---|---|
| 既定 `.text` / `.rodata`（ディスクリプタ配列・パレット・`cell_map`） | **bank128** | ○ 増える |
| `cd_data_ref`（`PCE_EDITOR_CD_REF_SECTION`） | **bank132** | ○ 増える |
| `.bss`（ランタイム state・cache） | **console_ram** | △ |
| `VN_BANKED_CODE` / `VN_BANKED_CODE2` を付けたコード | **bank129 / bank130** | ✕ **増えない**（機能=コード追加でのみ増える） |

**結論: 「アセットを増やすと溢れる」のは bank128（rodata）と bank132（cd_ref）。bank129/130 は
コードバンクでアセットとは無関係。** メタ情報の CD オフロードは bank128/132 にだけ効く。

### Kitahe の実測（resident モード, `--print-memory-usage`）
```
bank128: 88.70% (7266B)   ← .text + asset rodata
bank129: 98.45% (8065B)   ← 純コード（最も逼迫＝律速）
bank130: 94.54% (7745B)   ← 純コード
bank132: 45.85% (3756B)   ← cd_ref + VN data（4.4KB 空き）
```
Kitahe は**コードバンク逼迫**型でアセットは少ない。メタ情報は bank132(45%)に余裕があり、
**この種のプロジェクトではメタ CD 化は効かない（むしろ純損）**。

---

## 2. 実装済みの内容（このコミット）

### 2.1 オンデマンド化の本体
- ジェネレータ `pce-asset-manager.js`:
  - 全メタを CD data file **`assets/generated/meta/asset_meta.bin`**（固定長・セクタ整列レコード
    ＝メモリ構造体のパック画像＋付録[palette/cd_ref/cell_map インライン]）へ直列化
    （`buildAssetMetaBuffer` / `computeAssetMetaLayout` / `ensureAssetMetaReservation`）。
  - 常駐は定数ディレクトリ `pce_editor_{bg,sprite,adpcm}_meta` のみ emit。
  - レコードオフセットは生成ヘッダの `PCE_EDITOR_META_*` 定数とランタイムの `_Static_assert` で固定。
- ランタイム `template/template_pce_vn_cd/src/pce_vn_runtime.c`:
  - `vn_get_bg_asset` / `vn_get_sprite_asset` / `vn_get_adpcm_asset` がレコードを
    `cd_transfer_scratch`(bank132) へ読み、`__builtin_memcpy` でデコードして小 cache
    （BG 2 / Sprite 4 スロット, cell_map は console_ram）に載せ、構造体ポインタを返す。
  - BG パレットは fade ヘルパ(bank130)が CD 再フェッチしないよう `current_bg_palette[32]` に常駐スナップショット。
  - 冗長だった `pce_editor_sprite_draw_meta[]` テーブル依存を撤去し、sprite 描画フィールドは
    asset 構造体（`sprite->cell_width` 等）から直読み（resident/CD 両モードで成立）。

### 2.2 閾値ゲート（無条件 CD 化をしない理由）
無条件 CD 化は accessor の固定コストで**小規模だと純損**。よって:
- `assetMetaShouldUseCd()` = `CD ターゲット && estimateResidentMetaBytes > 予算`。
- 予算 `META_RESIDENT_BUDGET = 1536`（既定）。**環境変数 `PCE_ASSET_META_BUDGET`（バイト）で上書き可**
  （0=常に CD、巨大値=常に常駐）。テストはこれで両モードを決定的に切替。
- 生成ヘッダへ `#define PCE_EDITOR_ASSET_META_ON_CD 1/0`。**0 のとき**ランタイム accessor は
  `#else` の直接添字マクロに解決され、**未参照になって DCE で丸ごと落ちる（コスト 0・回帰なし）**。

### 2.3 accessor は必ず `VN_RESIDENT_CODE`（bank128, noinline）
`VN_BANKED_CODE`(129) で付けると CD ヘルパ（`map_vn_data`/`prepare_cd_data_access`/`cd_sector_*`）の
インラインコピーがそのバンクへ複製され膨張する。128/129/130 は co-resident なので 129/130 の
consumer から bank128 accessor を透過呼び出しできる。

### 2.4 検証結果
- **Kitahe は閾値未満で resident モード（flag=0）→ ビルド成功・ISO 450（commit 919c8a7 と同一）・
  asset_meta.bin は ISO に乗らない＝回帰なし。**
- `npm test` **107/107 パス**。meta モードは `PCE_ASSET_META_BUDGET=0` 強制で 3 テストが
  生成出力（meta ディレクトリ / asset_meta.bin）を検証。meta モードのランタイムは
  **コンパイル + `_Static_assert` 通過**（リンクだけ bank129 サイズ不足で失敗、下記）。

---

## 3. 未解決の課題（Codex への本題）

### 課題A：meta モードが bank129 を約1KB 肥大させ、リンクできないプロジェクトがある
**現象**: `PCE_ASSET_META_BUDGET=0` で Kitahe を強制 meta 化すると
`ld.lld: '.ram_bank129' ... overflowed by ~900B`。

**原因（実測の差分）**: resident→meta で
- bank128: +536B（accessor コード）／freed rodata は Kitahe では僅少
- **bank129: +1029B** ← consumer（`refresh_scene_sprites`/`copy_adpcm_voice` 等, 129）の
  アセット参照が「配列添字（リンク時定数, 定数畳み込み可）」から「accessor 戻りポインタ経由」に
  なり、**定数畳み込みが効かず関数が肥大**。accessor 自体は bank128(noinline)に出してあるので、
  これは accessor ではなく**呼び出し側コードの増分**。

**つまり**: メタ CD 化は bank128/132 を解放するが、**律速バンク 129 を逆に圧迫する**。
アセット多・コード軽いプロジェクトなら 129 に余裕があり純益、コードバンク満杯（Kitahe）だと不可。

#### 対応案（優先度順）
1. **consumer 側の肥大を抑える**（本命・低リスク）。129 の大物
   `run_commands_until_wait`(3148B) / `show_character_sprite_frame`(843B) / `refresh_scene_sprites`(822B)
   が accessor 戻り値をどう使っているかを見て、**ループ内で `vn_get_sprite_asset()` を 1 回だけ呼び、
   フィールドをローカルにコピーしてから使う**形に整理（現状は素直だが llvm-mos の -Oz が
   ポインタ経由 field load を都度生成して膨らむ可能性）。`--print-memory-usage` で 129 の増分が
   消えるか確認。
2. **129 のコードを 130/128 へリバランス**して meta の +1KB 分を空ける。ただし Kitahe は 130 も 94%・
   128 も meta 時 98% で**全バンク満杯**＝Kitahe では小手先では収まらない。[[vn-runtime-code-bank-budget]]
   の手順（`VN_BANKED_CODE`↔`CODE2` 付け替え）で均す。
3. **accessor / 小 cache を bank133 オーバーレイ or bank132 へ追い出す**（[pce-vn-overlay-pathb.md](pce-vn-overlay-pathb.md)）。
   ただし「consumer の肥大」は consumer が 129 にある限り残るので、案1と併用が必要。
4. **meta モードの適用判断を「129 に余裕があるか」まで含める**のは静的に難しい（129 はリンク後に
   しか分からない）。現状は「常駐メタが大きいか」だけで判断。案1で 129 増分を潰せれば、この
   判断のままで安全になる。

### 課題B：meta モードの ROM 動作未検証
閾値ゲートで Kitahe は resident のままなので、**meta モードの実機 ROM 動作は未検証**
（リンクが通るプロジェクトが手元に無い）。案A-1 で Kitahe の meta リンクが通れば、そのまま
Geargrafx で BG/sprite/ADPCM/メッセージを検証できる。または**アセット多・コード軽い検証用
プロジェクト**を用意して meta モードを実証する。

### 課題C：resident モードの実機目視（軽微）
今回 Geargrafx 実機スクショを取得できなかった（エミュレータ MCP が cue 再ロード拒否＋
computer-use 承認タイムアウト）。resident モードは commit 919c8a7（検証済み）と挙動等価
（palette snapshot は同一バイト、sprite フィールドは同じ構造体から読む）で ISO も同一だが、
一度 Test Play での目視確認を推奨。

---

## 4. 検証の回し方（このリポジトリ固有）

```sh
# CLI ビルド（エディタと同一パイプライン）。Kitahe をビルドして .cue を出す
node /tmp/build-kitahe.js          # ← tools/dev/vn-cli-build.js の Kitahe 版コピー
                                   #   （my_pce_game→Kitahe に差し替えただけ）

# バンク使用率を見る: pce-build-system.js の CD link args に一時的に
#   '-Wl,--print-memory-usage' を足してビルドし、ram_bank128/129/130/132 の % を読む
#   （commit には含めないこと）

# 両モードの強制切替
PCE_ASSET_META_BUDGET=0     node /tmp/build-kitahe.js   # meta モード（現状 bank129 で溢れる）
PCE_ASSET_META_BUDGET=999999 node /tmp/build-kitahe.js  # 常に resident

# テスト
npm test                                   # 107/107
node --test tests/pce-asset-manager.test.js tests/pce-vn-manager.test.js
```

- **per-symbol サイズ**は `data/tools/llvm-mos-sdk/llvm-mos/bin/llvm-nm --print-size --numeric-sort
  <out>/Kitahe.elf` を Python でアドレス帯（bank129 = `0x01810000`〜`0x0181FFFF`）でフィルタして見る。
  ただし**リンク失敗時は elf が出ない**点に注意（成功ビルドでしか per-symbol は取れない）。
- 実機: Geargrafx MCP（`mcp__geargrafx__*`）。`load_media`(.cue)→`debug_continue`→splash で RUN→
  メッセージ送りキー→`get_screenshot`。ADPCM 再生中フレームの画面/VRAM/VDC を必ず確認。

---

## 5. 変更ファイル一覧（このコミット）

- `pce-asset-manager.js` — メタ直列化・閾値判定（`assetMetaShouldUseCd`/`assetMetaBudget`/
  `estimateResidentMetaBytes`）・`PCE_EDITOR_ASSET_META_ON_CD` emit・モード別配列/ディレクトリ emit。
- `pce-vn-manager.js` — `collectCdDataFiles` の asset_meta.bin 追加を閾値判定でゲート。
- `template/template_pce_vn_cd/src/pce_vn_runtime.c` — accessor（`VN_RESIDENT_CODE`）・
  `PCE_EDITOR_ASSET_META_ON_CD` ゲート・BG palette snapshot・draw_meta テーブル撤去。
- `tests/pce-asset-manager.test.js` / `tests/pce-vn-manager.test.js` — 両モード対応に更新
  （meta モードは `PCE_ASSET_META_BUDGET=0` 強制）。
- `docs/pce-asset-meta-cd-ondemand.md`（新規）, `docs/pce-memory-bank-strategy.md`, `CLAUDE.md` — ドキュメント。
- メモリ: `vn-asset-meta-cd-ondemand`（バンク内訳と閾値の要点）。

> 前段の Step 1（シーン遷移時の冗長 preload 撤去・オンデマンド一本化）は別途 commit 919c8a7 済み。
