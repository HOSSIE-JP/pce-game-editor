# CLAUDE.md

このリポジトリは PC Engine / Super CD-ROM2 専用のゲームエディター `pce-game-editor`（Electron 製）です。
このファイルは Claude Code がこのリポジトリで作業するための指示です。元々 Codex 向けに書かれた `AGENTS.md` と同じルールを Claude 向けに整理したものです。**`AGENTS.md` の内容も有効です** — 矛盾する場合はこのファイルを優先してください。

## まず読むもの（変更前に）

作業対象に応じて、コードを編集する前に該当ドキュメントを読んでください。

- **PCE プラグイン / アセット / ビルド / Test Play を変更する前** → [PLUGIN.md](PLUGIN.md)
- **Test Play や実機/エミュレーター表示崩れを調査する前** → [docs/pce-testplay-debugging.md](docs/pce-testplay-debugging.md)
- **CD-ROM2 / VN runtime のメモリバンク配置を変更する前** → [docs/pce-memory-bank-strategy.md](docs/pce-memory-bank-strategy.md)
- **VN runtime のコードが 3 常駐バンク(128/129/130)を超える / bank133 コードオーバーレイ(Path B)を追加・拡張する前** → [docs/pce-vn-overlay-pathb.md](docs/pce-vn-overlay-pathb.md)
- **アセットのメタ情報（パレット/ディスクリプタ/cd_data_ref/cell_map）の常駐量・CD オンデマンド化を変更する前** → [docs/pce-asset-meta-cd-ondemand.md](docs/pce-asset-meta-cd-ondemand.md)
- **画像 / スプライト / ADPCM / CD-DA の実装** → [docs/pce-media-programming-guide.md](docs/pce-media-programming-guide.md)
- **AI Control（REST/MCP）API の仕様** → [AI_CONTROL.md](AI_CONTROL.md)

## ドキュメント更新ルール（重要）

- 公開 API、プラグイン manifest、IPC、ビルド仕様を変更する場合は、**同じ作業内で** `PLUGIN.md` または該当する `docs/` ファイルを更新してください。
- ユーザーに見える機能追加・仕様変更・既知制約の追加を行う場合は、**同じ作業内で** `README.md` / `docs/user-guide.md` / `PLUGIN.md` / 関連 `docs/` のいずれかを更新し、**最終回答で更新したドキュメントを明記**してください。

## 外部コードの扱い

- **外部リポジトリからコードをコピーしないでください。** 外部情報は挙動理解のためだけに使い、実装は独自に行ってください。
- PCE-CD の IPL / System Card、EmulatorJS runtime、llvm-mos-sdk などの外部バイナリは同梱しません。ユーザー所有ファイル / ユーザー操作によるダウンロードとして扱います。

## コマンド

```sh
npm install     # セットアップ
npm start       # 起動（= npm run dev）
npm test        # 回帰テスト（tests/run-tests.js）
npm run mcp     # 起動中エディターの REST bridge につなぐ MCP sidecar
```

ビルド: `npm run build:mac` / `npm run build:win` / `npm run build:win:installer`

## 回帰テスト

- コードを変更したら、**編集範囲に対応する最小限のテスト**を実行してください。
- PCE 全体の基本確認は `npm test`。AI Control の REST/MCP 境界、plugin manager、packaging、PCE asset/build/Test Play/VN まわりを含みます。
- テストを実行できない場合は、その理由と残るリスクを最終回答に書いてください。

## コミットメッセージ

このリポジトリでコミットを作成する場合、**コミットメッセージは日本語**で書いてください。（コミット/プッシュはユーザーが明示的に依頼したときのみ。）

## アーキテクチャと配置

- PCE 固有実装は `pce-*.js`、`plugins/pce-*`、`plugins/pc-engine-core`、`template/template_pce_*` を優先して確認してください。
- 共有アプリ基盤ユーティリティは本体に取り込んだ `game-editor-common.js` にあります（旧 `../game-editor-common` 外部パッケージは廃止）。このモジュールは特定ハードウェアの知識を持ちません。
- **PCE 固有のプロジェクト移行処理は `pce-project-migration.js`** に置き、共通ライブラリへ戻さないでください。
- Electron の **renderer / preload / main process の責務を分離**してください。
- **ファイルシステム IPC はプロジェクトルート内に限定**し、パストラバーサルを拒否してください。
- 画像アセットは内蔵 PCE 変換を使い、Superfamiconv には依存しません。
- CD-ROM2 は `targetMedia: "cd"` と `toolchain: "llvm-mos"` を前提に扱います。
- System Card external IRQ は CD data read / CD-DA pause/play / ADPCM load/stop/reset など BIOS helper の直前だけ有効化し、helper 後は真の ADPCM stream 中を除いて必ず切ってください。通常 message/typewriter 中に external IRQ を残すと、BIOS 側 IRQ が VDC timing/control を非同期に触り、BG が 1 フレームだけ水平にずれることがあります。
- CD-ROM2 VN runtime は System Card の VBlank handler を使いません。`delay_frame()` / `vn_wait_next_vblank()` は `IO_VDC_STATUS` の VBlank bit を直接 poll するため、`VN_VDC_CONTROL_BASE` には `VDC_CONTROL_IRQ_VBLANK` を入れますが、HuC6280 側の `IRQ_VDC` は `pce_irq_disable(IRQ_VDC)` で mask してください。`PCE_CDB_MASK_VBLANK_NO_BIOS` だけでは Geargrafx で System Card handler (`$E870`) が R5/R7/R8 を書くことがあるため、message 中のランダムな BG 水平ずれの原因になります。

## PCE 固有のノウハウ（変更時に壊しやすい点）

### メモリバンク / CD-ROM2
- 大きい画像 / sprite / ADPCM payload は `cd.dataFiles` に置き、RAM bank に詰め込まないでください。
- VN runtime のバンク割り当て: **bank128 = 常駐 .text/.rodata**（既定）、**bank129 = banked code (`VN_BANKED_CODE`)**、**bank130 = banked code 2 (`VN_BANKED_CODE2`)**、**bank132 = VN generated data**。128/129/130 は `PCE_RAM_BANK_AT(128,2)/(129,3)/(130,4)` で MPR slot 2/3/4 に**同時マップ（co-resident）**なので、3 バンク間の関数移動・相互呼び出しは透過的（バンク切替なし）。
- **コード用バンクは 128/129/130 の実質 3 つ（約24KB）が上限**。MPR slot5 = bank131 は BIOS を壊すため使えず（[[vn-12px-font-mask-storage]]）、slot6 は bank132(data)。全機能（ADPCM/PSG/sprite/choice 等）を使うプロジェクトはこの 3 バンクがほぼ満杯になる。Phase 2 + VBlank/VDC/SATB/message-window hardening 後の Kitahe CD build 実測は bank128=8087B(98.72%)、bank129=7963B(97.20%)、bank130=7545B(92.10%)、`.vn_overlay`=2260B/4096B。**未使用機能は DCE で落ちる**ため、Audio/Sprite コマンド追加で関連コードがリンクされ `ld.lld: .ram_bank129 ... overflowed` が出ることがある。対処は機能を諦めるのではなく **`VN_BANKED_CODE` ↔ `VN_BANKED_CODE2` の付け替え**または **Path B overlay 退避**で使用量を均すこと（`mos-pce-cd-clang -Wl,--print-memory-usage` で各バンク%を確認）。根本的に足りないときは runtime コード自体の削減が必要。
- CD-ROM2 VN の BG `map_vram.bin` は `VN_MAP_WIDTH`(=32) タイル幅の「ソース行」として扱い、`mapBase` から一括転送しないでください。`width_tiles` 分だけを行単位で BAT へ転送し、左右/上下余白は `clear_screen_map()` の blank tile を残します。画面は **256x224**・**BAT 32x32**。BG 画像は 256px(32 タイル)以下。
- メッセージフォントは **12x12**（1 行 17 文字 x 4 行）。`font.bin` は 12x12 1bpp マスク(24byte/字)で、起動時に VRAM へストリーム後、message 開始時にそのページの glyph mask だけを `.ram_bank132` cache へ先読みします。runtime のグリフコンポジタ（`draw_message_glyph_at` 他）は **bank133 overlay** に置き、VDC を触る resident dispatcher は IRQ lock → `pce_ram_bank133_map()` → 呼び出し → `pce_ram_bank130_map()` → IRQ unlock の順で復帰します。overlay entry は `map_vn_data()` で bank132 cache を保証し、cache を優先して 12px ピッチで read-modify-write 合成します。`vn_glyph_decode` / `vn_glyph_stride` は choice と overlay 共有のため `VN_RESIDENT_CODE`。全フォント分の常駐ピクセルバッファは持たず、コンポジタコードを bank128 に置かないこと。
- 文字種上限は **VRAM 依存（既定 tileBase で約1000 = `VN_MAX_GLYPH_COUNT`）**。メッセージ/選択肢の glyph ストリームはエスケープ符号化（index 0..252=1byte、253 以上=`0xfd`+16bit LE。stream byte `0xfe`=改行/`0xff`=終端 → runtime は 16bit `PCE_VN_GLYPH_NEWLINE`(0xfffe)/`PCE_VN_GLYPH_END`(0xffff) へ復号）。**runtime のグリフカーソルは値渡し+直接インクリメント**（`vn_glyph_decode`/`vn_glyph_stride` を `pos = pos + stride`）で実装すること。ポインタ経由 `(*pos)++` は HuC6280/llvm-mos でカーソルが進まず**先頭文字が全カラムに連続表示**される。表示バグは生成 scene pack の glyph stream を直接デコードしてエンコーダ/runtime を切り分ける。spritetext 用フォントは別系統で 254・1byte のまま。

### ADPCM
- `divider` は音量ではなく **ADPCM 再生 rate code**。`sampleRate` から `32000 / (16 - code)` に最も近い `0..15` の code を補完します（代表値: 32000Hz→15、16000Hz→14、8000Hz→12、4000Hz→8）。旧実装の `round(32000/sampleRate - 1)` などは読み込み時と runtime で補正します。
- generated metadata の `codec` / `nibbleOrder` / `encoderVersion` が現行値と違う場合は source WAV から再生成してください（同じ表記でも古い `encoderVersion` は先頭ノイズの可能性）。
- ADPCM preload は ADPCM RAM への先読みだけ。`loaded_adpcm_valid` が立っていても、再生時は必ず `pce_cdb_adpcm_play()` を呼んでください。
- VN runtime の短い one-shot / buffered 再生では、再生開始後に毎フレーム `pce_cdb_adpcm_status()` で自然終了監視しないでください（標準 WASM core で joypad edge が戻らなくなることがある）。
- 自然終了後に追加の `pce_cdb_adpcm_stop()` / `pce_cdb_adpcm_reset()` を投げないでください（明示的 AUDIO stop 時のみ stop/reset する）。
- ADPCM 1 asset の安全上限は `min(65535, 65536 - adpcmAddress)` bytes。再生時間概算 `bytes * 2 / sampleRate` 秒。
- **`stream: true` でも ADPCM RAM に収まる音声は buffered 経路（`read_from_cd`→`play`）で再生する**（`play_adpcm_voice` が `adpcm_voice_fits_buffer()` を先に判定）。`pce_cdb_adpcm_stream()` の真の CD streaming は RAM 超過 asset 専用。真の streaming は非同期 BIOS external IRQ で CD→ADPCM ring buffer を供給し続ける方式で、VBlank/VDC を IRQ なしの直接 poll で自前所有するこの runtime と衝突し、**再生中のノイズ・隣接セクタを読み込んで「全く別の音声」混入・CD/CPU ハング**を起こす。短尺音声を streaming へ戻さないこと。

### VN sprite / VDC
- VN sprite 表示は generated `pce_editor_sprite_draw_meta[]` の compact metadata を使い、単一 frame/default animation は sheet 全体表示として扱います。
- **sprite pattern は 16×16 cell 単位で dedupe される**（BG tile は dedupe しない）。`patterns.bin` はユニーク cell のみ、positional cell→slot の対応は `cellmap.bin`(1byte/cell) → `pce_editor_sprite_asset_t.cell_map`。`show_character_sprite_frame()` は `cell_map[]` 経由で frame cell を VRAM slot へ解決する。多 frame の大きな sheet が VRAM に収まるのはこのため。ユニーク cell 256 超は build error。
- **sprite `tileBase`(=`pattern_base`) の既定は 704**（VRAM word 22528 = message/font tile より後ろ・SATB `0x7f00` より前の共有領域）。dedupe 後でも `tileBase*32 + patterns.bin/2` が `0x7f00` を超えると **build error**（旧 warning 止まりを廃止）。**tileBase を 712(`PCE_VN_FONT_TILE_BASE`) 付近に置くと message tile・blank tile・glyph mask・SATB を上書きし、メッセージが化け、font 色変更で余白が緑等に化ける**（dedupe だけでは tileBase が悪いと直らない／tileBase だけでは大 sheet が VRAM を溢れるので両方必要）。
- **各フレームの表示時間は per-frame**。`pce_vn_sprite_anim_t.frame_delays`(resident rodata table, 長さ `frame_count`) を `tick_sprite_animations()` が `frame_delays[frame]` で参照する。スプライトエディタの time 行列(`spriteEditor.time`=`[[行0][行1]]`, 1行=1animation)→ `options.animations[].frameDelays` → vn.c の `pce_vn_sprite_anim_delays_N[]`。`frameDelays` 無しの旧 asset は正規化時に `spriteEditor.time` から移行、それも無ければ単一 `frame_delay` にフォールバック。**単一 `frame_delay` だけで実装し直さない**こと（per-frame が落ちる）。
- ADPCM 再生中も sprite/spritetext の tick/refresh を gate で止めないでください。口パク維持のため、frame 変化は slot に cache した animation metadata と既存 SATB layout を使い、pattern word だけを差分更新して fps 低下を抑える。別 asset へ差し替える full refresh では、sprite layer を無効化して未使用 SATB entry を画面外へ退避 → pattern VRAM 転送 → SATB/display enable の順で同期し、VRAM 書き換え中の表示を見せない。
- **sprite pattern の常駐キャッシュ (`loaded_sprite_pattern_valid`/`loaded_sprite_pattern_index`) は単一グローバル**。これを slot 別 (`[VN_SPRITE_SLOT_COUNT]`) 配列に変えて「複数スプライト同時表示時の毎フレーム再ロード(処理落ち)」を直そうとしたが、**Kitahe を含め全 sprite が既定 `tileBase 704` を共有しており、同一 VRAM 領域で上書きし合って片方が表示されなくなる**回帰を起こすため撤回した。複数スプライト同時表示の処理落ちは runtime のキャッシュ構造ではなく、**重ならない tileBase の割り当て**と**スプライトデータ側の更新頻度削減**で対処する。slot 別キャッシュを再導入するなら、必ず distinct tileBase を前提にし、共有 tileBase で表示が消えないことを Geargrafx で確認すること。
- VDC memory control は `VN_VDC_MEMORY_CONTROL` を使い、**sprite cycle bit を落とさない**でください。
- `pce_editor_vram_copy()` は resident/noinline の共通 VDC blit helper で、MAWR 設定から VRAM data 転送まで IRQ を mask します。message window clear、`write_map_words()` の BAT 行更新、raw BG/map/font/sprite pattern 転送を別 helper へ逃がして未ガードに戻さないでください。`pce_vdc_set_copy_word()` は R5 high byte を 0 にして DRAM refresh bit を落とすため、VN runtime では使わず、`vn_vdc_set_copy_word()` で R5 low byte を保ったまま high byte を `VN_VDC_CONTROL_BASE >> 8` へ戻してください。
- ADPCM 付き message 中に走る `refresh_scene_sprite_patterns()` は bank130 常駐のまま、SATB pattern/attr 差分更新の直前で `vn_wait_next_vblank()` を呼んで VBlank へ寄せます。Geargrafx の `huc6270_reg` R19 write breakpoint で表示期間 (`VDW`) に止まらないことを確認してください。CD/ADPCM/CD-DA BIOS helper 後の `restore_video_after_cdb_call()` は VBlank wait 後に VDC register 復元全体を mask し、display/sprite layer enable/disable も VBlank wait 経由で `set_vdc_control()` を呼びます。message 開始/全文 reveal の `clear_window_cells()` と glyph 一括描画は表示中に 208 tile 以上の VRAM を連続更新するため、`begin_message_window_vram_update()` で display blank + `pending_display_enable` を立て、描画後に `end_message_window_vram_update()` で戻します。`set_vdc_control()` と screen-shake scroll の `apply_screen_offset()` は単独呼び出し時にも IRQ guard します。単発 `pce_vdc_poke` の latch 競合や、表示期間中の R5/R7/R8/R9/R10 書き換えを残さないでください。

### VN message / ADPCM 文字送り
- **文字送り速度は build 時にエディタが計算して `textSpeedFrames` に焼き込む**（runtime は焼き込み値をフレームタイマで使うだけ。再生長計算を runtime に戻さない）。`round(round(byteLength*2*60/実レート) / 描画グリフ数)`。**実レートは公称 `sampleRate` でなく量子化レート `32000/(16-code)`**（runtime `adpcm_rate_code` と一致）を使う。`ceil`+末尾 pad 加算は使わない（音声より遅れる）。
- **文字送り計算の分母は改行を除いた発話文字数**。改行は発話されないので runtime の `draw_message_next_glyph` は改行で tick を消費せず（`continue` でループ）次の描画グリフまで進む。scene pack の `glyph_count` は改行込み全エントリ数（反復用）で別。
- **ADPCM 再生中の文字送り遅れは timing 補正ではなく毎フレーム処理コスト削減で扱う**。過去に `delay_frame` で VBlank を数える / `adpcm_play_frames_remaining` を実フレーム減算する / 文字表示を ADPCM カウンタへ比例追従させる実装は、**ADPCM 再生中の画面の乱れ・文字が音声後に出る・低速化**という回帰を起こして撤去した。sprite animation の frame 変化では、既存 SATB layout を保ったまま SATB の pattern word だけを更新し、`clear_sprites()`・palette upload・pattern CD load・64 entry 全転送を再導入しないこと。ADPCM 再生中だからという理由で sprite/spritetext refresh を止めず、口パクは差分 refresh で継続する。voiced message の glyph mask は ADPCM 開始前に RAM cache へ先読みし、音声中の `draw_message_glyph_at()` で毎 glyph の VRAM 読み戻しを繰り返さない。glyph compositor は tile と glyph の交差範囲だけを走査し、前 glyph が重ならない tile では合成ループへ入らない。active message record は開始時に `active_message_state` へ保持し、typewriter tick/auto advance で `scene_pack_read_message()` を毎フレーム再実行しない。`delay_frame` の VBlank polling は inline asm の tight loop と短い guard で命令数/I/O read 数を抑える（VBlank を数える補正ではない）。`delay_frame` の `service_*` 呼び出し順、`IO_VDC_STATUS` の追加読み出し（VBlank フラグを消す）、tick 内の合成ループ多重実行は表示を壊しやすい。修正する場合は Geargrafx で **ADPCM 再生中フレームの画面・VRAM・VDC を必ず確認**し、`debug_step_frame` は 1:1 を強制して実時間のフレーム落ちを隠す点に注意。`pce_cdb_adpcm_status()` の毎フレームポーリングは WASM core を固めるので不可。

### Test Play / エミュレーター
- PCE の描画崩れ、VRAM/SATB/VDC レジスタ調査、Test Play の実画面デバッグでは、利用可能なら **Geargrafx MCP を優先**してください（`geargrafx-debugging` / `geargrafx-romhacking` スキル、`mcp__geargrafx__*` ツール）。
- Super CD-ROM2 / ADPCM の挙動確認では **標準 EmulatorJS/WASM だけを正としない**でください。Geargrafx で正常動作し標準 WASM だけが ADPCM 再生後に入力待ちから進まないことがあります。まず ADPCM あり/なし比較、frame counter、`simulateInput()` 直接注入、読み込まれた core を確認し、**runtime を壊す変更で回避しようとしない**でください。
- Test Play の外部エミュレーター起動は `pce-external-emulator` plugin が担当。`testPlay.externalEmulator.executablePath` / `extraArgs` は Test Play role が `pce-external-emulator` のときだけ有効。macOS の Geargrafx 既定は `/Applications/Geargrafx.app/Contents/MacOS/geargrafx` で、`.app` bundle path は main process で `Contents/MacOS` の実行ファイルへ解決してから ROM / CUE path を渡します。

## Claude Code 計画と実装時の利用モデルについて
あなたが Opus 4.8で動いているなら以下に従ってください。
設計、コードベースのリサーチ、レビューはメインセッションであるOpus 4.8で行ってください。
実装はトークンを節約するためにCodexに依頼するか、Sonnet/GPT-5.3-Codex-Sparkでサブエージェントとして実行して。
ただし、実装難易度が高い場合にはメインセッション（Opus 4.8）で実装してください。

## Claude Code と Codex の役悪分担

### Codexが担当する作業
- 実装
- コードレビュー（実装完了後に必ず実施）
- リファクタリング・テスト生成

### 委譲ルール
1. 実装タスクを受けたら、規模を判定して Codex への委譲を検討する
2. 実装完了後は `/codex:rescue` または `mcp__codex__codex` でレビューを依頼する
3. Claude Code が詰まったら `/codex:rescure` スキルで Codex に引き継ぐ

### Codex の呼び出し方

```bash
# CLI から直接
codex <<EOF
<依頼内容>
EOF
```

または Claude Code が MCP ツール `mcp__codex__codex` を使って直接呼び出す。

## 報告方法
思考は英語でかまいませんが、最終的な報告は日本語で行なってください。
