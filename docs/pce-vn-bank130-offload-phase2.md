# Phase 2 引き継ぎ: bank130 → bank133 overlay オフロード（message compositor）

このドキュメントは、VN runtime の **bank130 を空けるために message グリフコンポジタを bank133 overlay へ移す**作業（Phase 2）を別担当（Codex）が引き継ぐための資料です。**未実装**。先に [docs/pce-vn-overlay-pathb.md](pce-vn-overlay-pathb.md)（overlay = Path B の機構）と [CLAUDE.md](../CLAUDE.md) の「メモリバンク / CD-ROM2」「VN sprite / VDC」節を読んでください。

## なぜやるか（背景）

- VN runtime のコードバンク 128/129/130 は恒常的に逼迫（95〜99%）。bank130 が満杯で、ADPCM/BG 中のスプライト破壊を直す **BG blit IRQ ガード**（`pce_editor_vram_copy` を noinline 常駐化してガード）が **LTO インラインカスケードで bank130 を ~700B 溢れさせて入らなかった**。
- **Phase 1（完了・別ブランチ `refactor/vn-remove-rle` で commit `5e9fb26` 済み）**で RLE 圧縮を撤去し、**bank133 overlay が 4037B → 525B（約 3.5KB 空き）**になった。overlay は bank130 と MPR slot4 を時分割する offload 先なので、ここへ bank130 関数を移せば bank130 を空けられる。
- 目標: bank130 に **700B 以上**の余力を作り、保留中の BG blit IRQ ガード等を収められるようにする。

## Phase 1 後の現状（実測）

| バンク | 使用 | 備考 |
|---|---|---|
| bank128(.text, slot2 常駐) | 7818B (95.43%) | ~370B 空き |
| bank129(VN_BANKED_CODE, slot3) | 7801B (95.23%) | |
| bank130(VN_BANKED_CODE2, slot4) | 7993B (97.57%) | **ここを空けたい** |
| .vn_overlay(VN_OVERLAY_CODE, bank133, slot4 と時分割) | 525B / 予約4096B | `refresh_scene_sprite_patterns_impl` のみ。**~3.5KB 空き** |

128/129/130 は MPR slot2/3/4 に同時マップ（co-resident）。bank133 は overlay 実行時のみ slot4 に入り、その間 **bank130 は不可視**。

## overlay の機構（Path B のおさらい）

- overlay 関数は `VN_OVERLAY_CODE`（`__attribute__((noinline, section(".vn_overlay")))`）。link 後 objcopy で `overlay.bin` に抽出し、起動時に `load_overlay_code()` が bank133 へストリーム。
- 呼び出しは **resident(bank128) ディスパッチャ**経由。既存の雛形（このパターンを踏襲）:
  ```c
  static uint8_t VN_RESIDENT_CODE refresh_scene_sprite_patterns(void) {
  #if defined(__PCE_CD__)
      uint8_t result;
      pce_ram_bank133_map();           // slot4 = bank133 (overlay)。bank130 は不可視に
      result = refresh_scene_sprite_patterns_impl();  // overlay 関数を呼ぶ
      pce_ram_bank130_map();           // slot4 = bank130 に戻す
      return result;
  #else
      return refresh_scene_sprite_patterns_impl();
  #endif
  }
  ```
- **呼び出し元が bank130 でも OK**（resident ディスパッチャ経由なら、JSR 中に bank130 コードが unmap されても、戻り時に復帰する）。

## overlay 関数の鉄則（守らないと実機クラッシュ）

1. **`delay_frame()` を呼んではいけない。** `delay_frame`（runtime.c 463）は `pce_ram_bank130_map()` を呼び **slot4 を bank130 へ張り替える**。overlay 実行中にこれを呼ぶと自分(bank133)が消えて自滅する。
2. **他の bank130(`VN_BANKED_CODE2`) 関数を直接呼んではいけない**（slot4=bank133 なので bank130 は不可視）。呼ぶなら resident ディスパッチャ経由か、その関数も overlay へ移すか、resident/inline 化する。
3. **bank132(slot6) のグローバルにアクセスするなら、overlay 内で `map_vn_data()` を呼んで slot6=bank132 を保証する**（`map_vn_data` は slot6 を触り slot4 は触らないので overlay から安全）。
4. resident(bank128/slot2)・bank129(slot3)・inline・console_ram/.bss（常駐）・CD BIOS は呼んで/触ってよい。

## 移行対象クラスタ（message グリフコンポジタ）

bank130 の以下を **overlay へ移す**（行番号は Phase 1 後の `template/template_pce_vn_cd/src/pce_vn_runtime.c`、移動で変動するので関数名で追うこと）。**いずれも `delay_frame`・bank130 マップを呼ばない**ことを確認済み（grep で 1700–1965 に該当呼び出し無し）。

| 関数 | 概算サイズ | 備考 |
|---|---|---|
| `draw_message_glyph_at`(~1875) | 665B | VDC mask 読み + 合成タイル書き。callee は cluster + resident(`pce_editor_vram_copy`,`pce_vdc_copy_from_vram`) |
| `add_glyph_tile`(~1725) | 298B | 合成。cluster 内のみ |
| `encode_msg_tile`(~1710) | ~ | エンコード。純粋 |
| `cached_message_glyph_mask`(~1831/1863) | ~ | mask cache へのポインタ返却。**bank132 の `message_glyph_cache_masks` を参照** |
| `preload_message_glyph_masks`(~1869) | 319B | mask を **bank132 cache** へ先読み。callee=cached_message_glyph_mask+`pce_vdc_copy_from_vram`+decode/stride |
| `draw_message_next_glyph`(~1921) | ~ | typewriter 1グリフ/呼び。callee=draw_message_glyph_at+decode/stride |
| `draw_message_text`(~1955) | ~ | 一括描画。callee 同上 |

**`vn_glyph_decode`(~1803) / `vn_glyph_stride`(~1814) は overlay でなく `VN_RESIDENT_CODE`(bank128) 化する。** 小さい純粋関数で、overlay コンポジタと bank130 の `draw_choice_options` 双方から呼ばれるため、resident にすれば両方から直接呼べてディスパッチャ不要。

**bank132 の注意**: `message_glyph_cache_masks` は `.ram_bank132`(slot6)（runtime.c 1702）。`cached_message_glyph_mask` / `preload_message_glyph_masks` / `add_glyph_tile`(cache 経由) がこれを触る。**overlay 化したエントリ（`preload_message_glyph_masks` と `draw_message_*`）の先頭で `map_vn_data()` を呼び slot6=bank132 を保証する**こと（既存 `refresh_scene_sprite_patterns_impl` も内部で `map_vn_data()`/`map_resident_data()` を呼んでいる）。他のグローバル（`composer_prev_mask`,`msg_enc`,`msg_mask8`,`message_glyph_cache_ids/count`）は `.bss`（常駐）なので問題なし。

## 結合（重要）: `draw_choice_options`

`draw_choice_options`(~3412, `VN_BANKED_CODE2`/bank130) は **`scene_pack_read_choice` / `scene_pack_read_choice_option`（bank130）と `clear_window_cells`（bank130）を呼ぶため overlay へ移せない**。一方で選択肢グリフ描画に `draw_message_glyph_at` / `vn_glyph_decode` / `vn_glyph_stride` を使う（runtime.c 3427/3430/3431/3433）。移行後:
- `vn_glyph_decode` / `vn_glyph_stride` は resident 化するので `draw_choice_options` から直接呼べる（変更不要）。
- `draw_message_glyph_at` は overlay へ移るので、`draw_choice_options` は **`call_overlay_draw_message_glyph_at`（resident ディスパッチャ）経由**で呼ぶ（選択肢は低頻度なので毎グリフ bank133 map/restore のオーバーヘッド許容）。

## 実装ステップ（推奨: 1ステップずつ Geargrafx 検証）

1. **`vn_glyph_decode` / `vn_glyph_stride` を `VN_RESIDENT_CODE` 化。** ビルド通過確認（bank128 が ~数十B 増、129/130 が減るはず）。Geargrafx でメッセージ・選択肢が正常表示を確認。
2. **compositor 7関数を `VN_OVERLAY_CODE` 化**し、overlay 化したエントリ（少なくとも `preload_message_glyph_masks` と `draw_message_*`）の先頭に `map_vn_data();` を追加（bank132 保証）。この時点では呼び出し元がまだ直呼びなのでビルドは通らない（次で直す）。
3. **ディスパッチャ整備**（resident bank128）:
   - 既存 `draw_message_next_glyph_locked` / `draw_message_text_locked`（IRQ ガード付きラッパー）を **`pce_ram_bank133_map()` → IRQ lock → overlay 関数 → IRQ unlock → `pce_ram_bank130_map()`** の形に変更（現状は `VN_MAP_BANK130_FOR_CODE()` 後に bank130 compositor を直呼び）。
   - `call_overlay_preload_message_glyph_masks`（新規 resident）を追加し、`start_message`(~3354) の `preload_message_glyph_masks(message)` 呼びを置換。
   - `call_overlay_draw_message_glyph_at`（新規 resident）を追加し、`draw_choice_options`(3427,3433) の `draw_message_glyph_at(...)` 呼びを置換。
4. **ビルド & `-Wl,--print-memory-usage`**: bank130 が ~1500B 減、overlay が ~2000B/4096予約 に増、bank128 が ディスパッチャ + decode/stride で微増、いずれもオーバーフローしないことを確認。`llvm-nm --print-size` で compositor が `.vn_overlay` に居ること、bank130 から消えたことを確認。
5. **Geargrafx 実機検証**（必須・下記チェックリスト）。
6. 余力確認後、別タスクで **BG blit IRQ ガード**を bank130 に入れる（`pce_editor_vram_copy` を noinline 常駐化 + IRQ lock。`docs/pce-testplay-debugging.md` の「割り込みと VDC レジスタの非再入性」参照）。

## 検証チェックリスト（Geargrafx 実機）

- メッセージの **typewriter 表示**（1文字ずつ）と**ボタンスキップの一括表示**が正常（化け・欠落・UI 外ノイズ無し）。
- **voiced message（ADPCM）中の口パク + 文字送り**が正常（compositor は ADPCM 中も毎フレーム走る）。`message_glyph_cache_masks`(bank132) の先読みが効いているか。
- **選択肢メニュー**の表示（カーソル + 各選択肢グリフ）が正常（`draw_choice_options` のディスパッチャ経由描画）。
- 改行を含むメッセージ、escape 符号化グリフ（index ≥253）の表示。
- **BG 切替 + ADPCM 反復**でメッセージ/スプライトが壊れない（Phase 1 で RLE-MAWR 脆弱性は解消済み）。
- `debug_step_frame` は 1:1 を強制し実時間のフレーム落ちを隠す点に注意（CLAUDE.md）。

## 罠（過去に踏んだ/踏みやすい）

- overlay 関数から `delay_frame` を呼ぶ（自滅）。typewriter の frame 待ちは**呼び出し元**（`tick_active_message`/`start_message`、bank128）が持つので compositor は delay_frame を呼ばない設計を維持。
- bank132 の `message_glyph_cache_masks` を slot6 未マップで読む（化け）。→ overlay エントリで `map_vn_data()`。
- ディスパッチャで `pce_ram_bank130_map()` の復帰を忘れる / 順序を誤る（以後 bank130 不可視のまま暴走）。
- `-Oz` の LTO が compositor を bank130 呼び出し元へインライン展開してしまう（`VN_OVERLAY_CODE` の noinline で防ぐが、呼び出し元のインライン判断が動いて他バンクが溢れることがある。`--print-memory-usage` で必ず全バンク%確認）。
- `always_inline` ストリームヘルパの noinline 化は別クラスのバグ（[[vn-glyph-stream-16bit-escape]]）。触らない。

## 参考: 関連ファイル/シンボル

- runtime: `template/template_pce_vn_cd/src/pce_vn_runtime.c`
- overlay 抽出: `pce-vn-manager.js` `finalizeOverlayBlob()`（overlay.bin 抽出 + `.rela.vn_overlay` strip。予約は `VN_OVERLAY_RESERVED_SECTORS`）
- 既存 overlay 関数/ディスパッチャ: `refresh_scene_sprite_patterns_impl` / `refresh_scene_sprite_patterns`
- bank マップ helper: `pce_ram_bank133_map()` / `pce_ram_bank130_map()` / `map_vn_data()` / `VN_MAP_BANK130_FOR_CODE()`
- ビルド: `data/tools/llvm-mos-sdk/llvm-mos/bin/mos-pce-cd-clang.bat -Oz -DPCE_EDITOR_TARGET_CD=1 -Wl,--print-memory-usage -Wl,-T,<proj>/src/generated/overlay_insert.ld -o <proj>/out/X.elf <proj>/src/main.c <proj>/src/generated/assets.c <proj>/src/generated/vn.c`（template を `<proj>/src/pce_vn_runtime.c` へ反映してから）
