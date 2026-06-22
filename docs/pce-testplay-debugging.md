# PCE Test Play Debugging

このメモは、PC Engine / Super CD-ROM2 の Test Play や描画崩れを Codex が調査するときの運用です。

## 基本方針

- PCE の画面荒れ、波打ち、タイル化け、スプライト化けは、利用可能なら Geargrafx MCP でデバッグします。
- EmulatorJS / ブラウザーキャプチャは再現確認やユーザー向け見た目確認に使い、原因特定は Geargrafx MCP の VDC / VRAM / SATB / palette 情報を優先します。
- CD-ROM2 は `targetMedia: "cd"` と `toolchain: "llvm-mos"` 前提です。System Card / IPL はユーザー所有ファイルとして扱い、リポジトリへ同梱しません。
- Super CD-ROM2 / ADPCM の確認では、標準 EmulatorJS/WASM だけを正としません。Geargrafx や外部エミュレーターで正常に進む場合は、ROM/runtime 全体ではなく標準 WASM core の差分として扱います。
- Geargrafx MCP がこのセッションで見えない場合は、まず MCP ツール discovery と接続状態を確認し、それでも使えないときだけ Electron Test Play キャプチャを暫定手段にします。

## 推奨手順

1. `PLUGIN.md` とこのファイルを読み、変更対象が PCE runtime / asset / build / Test Play のどこかを切り分けます。
2. 対象プロジェクトを通常のビルド経路でビルドし、`.cue` / `.pce` の出力を確認します。
3. Geargrafx MCP で出力 ROM / CUE を起動し、ゲーム開始後の問題フレームまで進めます。
4. VDC control register を確認し、DRAM refresh、VRAM increment、BG / sprite enable が意図通りかを見ます。
5. BG map、tile VRAM、font/UI tile 領域、palette bank を確認し、マップが参照しているタイル番号と実データが一致しているかを見ます。
6. スプライト化けでは SATB の `x` / `y` / `pattern` / `attr`、sprite pattern VRAM、sprite palette を合わせて確認します。
7. 修正後は Geargrafx MCP で同じフレームを再確認し、必要なら Electron Test Play でもユーザーが見る画面をキャプチャします。

## 標準 WASM だけ ADPCM 後に進まない場合

既知の切り分け結果として、Geargrafx では正常に進む Super CD-ROM2 / VN project が、標準 EmulatorJS/WASM の `mednafen_pce-wasm.data` だけ ADPCM 再生後に message input を受け付けず、同じ frame が描画され続けることがあります。この状態では emulator の frame counter は進み、`gameManager.simulateInput()` で PCE button index を直接注入しても VN script が次 command へ進みません。ADPCM command を抜いた同一 scene は同じ入力注入で進むため、単純な window focus / key mapping の不具合とは区別します。

再発防止メモ:

- 「ADPCM 再生中に次 command へ進んだ」だけでは合格にしません。短い voice が自然終了する時点まで待ち、その後の `wait` / next message が実行されるかを確認します。
- 画面が同じままでも、原因は VN command scheduler、joypad edge、CPU 停止のどれかで異なります。`simulateInput()` で進まない場合でも入力経路だけを疑わず、ADPCM 完了IRQで CPU が止まるケースを先に除外します。
- 標準 WASM だけで再現し、Geargrafx / 外部エミュレーターで再現しない場合は、runtime の正しい実機寄り挙動を壊して回避しないでください。WASM core 固有の IRQ / BIOS helper 差分として切り分けます。
- `pce_cdb_adpcm_status()` の stopped bit を毎 frame 監視する修正、自然終了後の追加 `pce_cdb_adpcm_stop()` / `pce_cdb_adpcm_reset()`、ADPCM divider や encoder を触る修正は、この症状の初手にしません。

調査手順:

1. Geargrafx MCP または `pce-external-emulator` で同じ `.cue` を起動し、ADPCM 後の message advance が正常か確認します。
2. 標準 EmulatorJS 側では console log で読み込まれた core が `mednafen_pce-wasm.data` か、legacy core へ落ちていないかを確認します。
3. Electron Test Play では frame counter が進むかを確認し、停止しているのが emulator 全体か VN input path かを分けます。
4. 同じ project から ADPCM audio command だけを抜いた比較 build を作り、同じ `simulateInput()` 注入で次 message / scene へ進むか確認します。
5. `message.voiceAssetId` 付き auto message の直後に ADPCM の想定再生時間より長い `wait` と次 message を置き、入力なしで最後の message へ到達するか確認します。ADPCMなし対照だけが進む場合は、command advance ではなく ADPCM 完了時点の問題を疑います。
6. Geargrafx が正常で標準 WASM だけが止まる場合、VN runtime の割り込みや ADPCM 終了処理をむやみに変えないでください。ADPCM one-shot / buffered / streaming 再生は、再生開始後に毎フレーム `pce_cdb_adpcm_status()` で自然終了監視しないでください。標準 WASM core では ADPCM 終了まで status polling した後に joypad edge が戻らないことがあります。現行 runtime は data size と sample rate から求めた frame counter で自然終了や streaming loop を管理します。
7. 標準 WASM core では buffered ADPCM one-shot の完了IRQで CPU が止まることがあります。現行 runtime は ADPCM load / CD data read / stop など BIOS 操作時だけ external IRQ を有効にし、非loop buffered 再生中は `PCE_CDB_MASK_IRQ_EXTERNAL` で完了IRQをマスクします。
8. CD data read、CD-DA pause/play、ADPCM load/stop/reset の BIOS helper を追加・移動した場合は、必要な直前だけ external IRQ を有効にし、buffered ADPCM one-shot が再生中なら helper 後に再度完了IRQをマスクします。
9. ADPCM BIOS call 直後の message advance edge が標準 WASM core だけで落ちる場合があります。現行 runtime は ADPCM 再生開始後に次の joypad edge 判定を一度だけ初期化し、`message.voiceAssetId` 付き message でも次 command へ進めるようにしています。この初期化では現在押されている button を baseline にし、押しっぱなしの I/RUN を新規 edge として扱わないでください。`last_pad` を 0 に戻すと、ADPCM message 開始直後に `finish_active_message()` が走り typewriter が即スキップされます。
10. 自然終了済みの ADPCM へ追加の `pce_cdb_adpcm_stop()` / `pce_cdb_adpcm_reset()` を投げると、標準 WASM core で joypad edge が戻らない原因になります。明示的な AUDIO stop と自然終了 cleanup は分けて扱います。
11. それでも標準 WASM だけが止まる場合、実機寄り確認は外部エミュレーターを優先し、標準 WASM 側の制約として記録します。

最小再現 scene の形:

```jsonc
[
  { "type": "message", "text": "ADPCMさいせい", "voiceAssetId": "voice_01", "advanceMode": "auto", "autoWaitFrames": 1 },
  { "type": "wait", "frames": 90 },
  { "type": "message", "text": "かんりょうごも うごいています", "advanceMode": "auto", "autoWaitFrames": 1 }
]
```

この scene は手入力に依存しないため、ADPCM BIOS call 直後の joypad edge 問題と、ADPCM 自然終了時の CPU 停止問題を分けやすいです。比較用に `voiceAssetId` だけを外した build も作り、標準 WASM の同じ core で最後の message へ到達するか確認してください。

## 割り込みと VDC レジスタの非再入性（スプライト破壊）

VDC の 2 レジスタ I/F（$0000 = レジスタ選択 latch、$0002 = データ）は**再入不可**です。VRAM/SATB 転送は MAWR（書き込みアドレス）を設定→データ語を連続書き込みする手順で、途中で別経路が VDC を叩くと latch / 書き込みアドレスが壊れ、残りの転送が**別レジスタ・別 VRAM アドレス**へ着弾します。ADPCM/CD 再生中は System Card external IRQ が有効なので、この最中に IRQ が割り込むとスプライト（SATB / pattern）が壊れます。

IRQ アトミック化のヘルパは `vn_vdc_irq_lock()`/`vn_vdc_irq_unlock()`（I フラグを php/plp で退避・SEI して復元。boot 等で IRQ 無効でも誤って有効化しない save/restore）。現在ガード済みの経路:
- **口パクスプライト**（`upload_sprite_pattern_words()`、毎フレームの SATB 差分書き換え）= 「ADPCM 再生でスプライトが壊れる」。
- **メッセージグリフ描画**（`draw_message_next_glyph_locked()`/`draw_message_text_locked()`、bank128 常駐ラッパーで `draw_message_glyph_at` の VDC mask 読み+合成タイル書きを丸ごと囲む）= 「メッセージ描画タイミングで UI 外側にノイズ」。
- **SATB 全アップロード**（`upload_sprite_table()`）= BG/シーン変更後のスプライト再表示。

これらは bank128 常駐（または常駐ラッパー）でガードを 1 か所に持つことで、満杯の bank129/130 へインライン展開させずに収めています。むしろ巨大な compositor 関数（`draw_message_*`）を**呼び出し元4箇所への重複インラインから常駐単一実体へ移す**ことで bank の空きが増えました（実測 bank130 が 99.73%→98.21% に低下）。

- **BG タイル RLE アップロード（`cd_rle_ref_to_vram`, overlay）= MAWR 自己修復で対処済み**。RLE writer は MAWR を **CD 読み込み（refill）を跨いで保持**します。CD 読み込みは `prepare_cd_data_access()` が external IRQ を有効化する＝読み込み中に IRQ が MAWR を壊すと、以降の BG タイルがスプライト/SATB 領域へ流れます（「BG 描画でスプライトが壊れる」「反復で破綻」と整合）。CD 読み込みに IRQ が必要なため全期間マスクは不可。代わりに `vn_cd_byte_stream_t.refilled` フラグで refill を検知し、**refill 後に `vram_byte_writer_resync()` で MAWR を writer の現在ワード位置（`dest + bytes_written/2`、mid-stream の bytes_written は常に偶数なので正確）へ再設定**します（壊れていれば修復、無事なら同値の no-op）。overlay は +230B（4037/4096B、残 59B = **逼迫**。これ以上 overlay を増やす変更は予約 sector 数 `VN_OVERLAY_RESERVED_SECTORS` の見直しが要る）。
- **未ガードの残り**: (1) BG **マップ** RLE writer（`cd_rle_bg_map_ref_to_vram`）。マップは小さく（~1 sector）行ごとに MAWR を張り直すため mid-row refill の窓がほぼ無く低リスク。(2) **非圧縮 BG の生 CD blit**（`pce_editor_vram_copy()` 直呼び）。`pce_editor_vram_copy()` を直接ガードすると **LTO 二次インラインカスケード**で bank130 が +約700B 溢れる（自体は bank128 単一実体だが、サイズ変化が全体のインライン判断を変える）。非圧縮 BG は RLE より稀なので後回し。どちらも残す場合は Geargrafx で確認しながら対処。
- ガードは `--print-memory-usage` で bank128/129/130 の % を必ず確認すること。`memory` クロバーは付けない（volatile 同士の順序は保たれ、付けると満杯バンクのアップロードコードを deopt して溢れる）。

## 見るべき典型ポイント

- 波打ちや画面全体の破綻: VDC control の DRAM refresh が表示切り替え時にも保持されているか。
- BG の崩れ: `tileBase * 16`、map base、VRAM copy destination、map word の palette bank / tile index。CD-ROM2 VN の `map_vram.bin` は `mapBase` から一括転送せず、64幅ソース行から `width_tiles` 分だけを行単位でBATへ置く。
- UI / font の縦縞: 空白タイルの VRAM 内容、font tile base、UI palette bank、window fill map。
- スプライト崩れ: SATB の pattern 値、pattern VRAM destination、16x16 pattern のエンコード順、width / height attr。
- CD-ROM2 固有の差: BIOS helper 経由の SATB 更新、VDC copy mode、banked asset の RAM bank 切り替え。

## 回帰確認

- コード変更後は編集範囲に対応する最小限のテストを実行します。
- PCE 全体の基本確認は `npm test` です。
- 画面系の修正では、テストだけでなく Geargrafx MCP か Test Play キャプチャで実画面を確認します。
- ADPCM 後の進行修正では、標準 EmulatorJS/WASM の `mednafen_pce-wasm.data` で ADPCMあり/なしの最小 scene を両方確認し、ADPCMありでも自然終了後の next message へ到達することを合格条件にします。
