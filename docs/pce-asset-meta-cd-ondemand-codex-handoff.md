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

## 3. Codex 追記（2026-06-21）: 課題A/B/C は解決済み

`template/template_pce_vn_cd/src/pce_vn_runtime.c` の meta モードを実用化した。Kitahe は
`PCE_ASSET_META_BUDGET=0` の強制 meta モードでもリンク成功し、Geargrafx で BG / sprite /
message / ADPCM 再生まで確認済み。resident 強制モードも同じ導線で回帰なし。

最終実測:

```
PCE_ASSET_META_BUDGET=0 node /tmp/build-kitahe.js      # 成功
  .text + .rodata:    8093B
  .ram_bank129:       8079B
  .ram_bank130:       8155B
  .ram_bank132:       3700B
  .vn_overlay:        3775B / 4096B

PCE_ASSET_META_BUDGET=999999 node /tmp/build-kitahe.js # 成功
  .ram_bank129:       7555B
  .ram_bank130:       8035B
  .ram_bank132:       3756B
  .vn_overlay:        3695B / 4096B
```

今回の追加修正:

- `vn_get_*_asset()` の戻り値は hot path の入口で 1 回だけ取り、sprite draw field / `cell_map` /
  ADPCM field は local または runtime-owned snapshot へ落としてから使う。
- 当時は `refresh_scene_sprite_patterns_impl()` を Path B overlay（bank133）へ退避し、
  bank129 の増分を抑えた。後続の VBlank/SATB hardening では、per-frame SATB 差分更新を
  VBlank へ寄せるため bank130 常駐へ戻している。overlay から bank130 関数を呼ばない制約は継続。
- meta cache key は `idx + 1` の `uint8_t` sentinel にした。`int16_t = -1` の非ゼロ初期値は
  `.zp.data` / `.data` 初期化に依存し、asset index 0 の false hit を起こし得る。
- ADPCM meta accessor は struct image / CD ref の `memcpy` を使わず、生成ヘッダの固定 offset から
  scalar decode する。`__builtin_memcpy(&g_adpcm_cd, ...)` は llvm-mos が destination を `$0089`
  へ落とす形になり、WRAM `$2089` の CD ref が 0 のままになる。
- `copy_adpcm_voice()` は `voice->data_size` などの multi-byte field を local scalar 経由で
  snapshot へ書く。直接の連続 field 代入は `tii $7c,$6a,#$4` のように高位アドレスを落とした
  転送へ最適化され、WRAM `$207c` ではなく zero page `$007c` からコピーすることがある。

Geargrafx 検証メモ:

- `SDL_AUDIODRIVER=dummy geargrafx --headless --mcp-http ...` を使い、通常生成 CUE をロード。
  splash の `PUSH RUN BUTTON!` まで約 1800 frame 進めてから RUN。
- meta mode: tap 3 で ADPCM `playing=true`, `status_register=08`, `address=4F10`,
  `frequency_khz=16`, sprite pattern `160..173` を確認。WRAM snapshot は
  `data_size=0x4f10`, `sector=0x53`, `sector_count=0x000a`, `has_cd=1`。
- resident mode: 同じ導線で ADPCM `playing=true`, `status_register=08`, `address=4F10`,
  sprite pattern `160..173` を確認。

以下の「課題A/B/C」は履歴として残す。新しい作業では上記の完了状態を正とすること。

## 4. 旧・未解決課題（履歴）

### 旧 2026-06-21 Codex 追記: 課題A はリンク面では解決（履歴）

最終修正後の値と Geargrafx 検証結果は上の「Codex 追記（2026-06-21）: 課題A/B/C は解決済み」を正とする。
この節は、consumer snapshot と overlay 退避で最初にリンク成功した時点の履歴。

`template/template_pce_vn_cd/src/pce_vn_runtime.c` 側で、sprite consumer の hot path を
`vn_get_sprite_asset()` で取得した descriptor から必要 field を snapshot して使う形へ寄せたうえで、
bank129 を圧迫していた `refresh_scene_sprite_patterns()` を当時は Path B overlay
（`refresh_scene_sprite_patterns_impl`, bank133）へ退避し、`cache_sprite_animation()` と
`adpcm_voice_fits_buffer()` を bank130 へリバランスした。後続の VBlank/SATB hardening では
`refresh_scene_sprite_patterns_impl()` を bank130 常駐へ戻している。accessor は引き続き
`VN_RESIDENT_CODE`（bank128, noinline）のまま。

実測:

```
PCE_ASSET_META_BUDGET=0 node /tmp/build-kitahe.js      # 成功
  bank128 .text/.rodata: 8105B
  bank129:             8151B
  bank130:             8157B
  overlay(.vn_overlay): 3775B / 4096B

PCE_ASSET_META_BUDGET=999999 node /tmp/build-kitahe.js # 成功
  bank129:             7555B
  bank130:             8035B
  overlay(.vn_overlay): 3695B / 4096B
```

overlay の非内部 slot4 呼び出しは避けること。`refresh_scene_sprite_patterns_impl()` は
bank128/bank129 と console/BSS/data だけを使い、bank130 関数を呼ばない前提で成立している。
今後 `refresh_scene_sprite_patterns_impl()` に処理を足す場合は、`llvm-objdump -d --section=.vn_overlay`
で 0x8000-0x9fff の非内部 JSR/JMP が無いことを再確認する。

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

## 5. 検証の回し方（このリポジトリ固有）

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

## 6. 変更ファイル一覧（このコミット）

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
