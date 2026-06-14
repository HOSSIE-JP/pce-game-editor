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

調査手順:

1. Geargrafx MCP または `pce-external-emulator` で同じ `.cue` を起動し、ADPCM 後の message advance が正常か確認します。
2. 標準 EmulatorJS 側では console log で読み込まれた core が `mednafen_pce-wasm.data` か、legacy core へ落ちていないかを確認します。
3. Electron Test Play では frame counter が進むかを確認し、停止しているのが emulator 全体か VN input path かを分けます。
4. 同じ project から ADPCM audio command だけを抜いた比較 build を作り、同じ `simulateInput()` 注入で次 message / scene へ進むか確認します。
5. Geargrafx が正常で標準 WASM だけが止まる場合、VN runtime の割り込みや ADPCM 終了処理をむやみに変えないでください。短い ADPCM one-shot / buffered 再生は、再生開始後に毎フレーム `pce_cdb_adpcm_status()` で自然終了監視しないでください。標準 WASM core では ADPCM 終了まで status polling した後に joypad edge が戻らないことがあります。
6. 自然終了済みの ADPCM へ追加の `pce_cdb_adpcm_stop()` / `pce_cdb_adpcm_reset()` を投げると、標準 WASM core で joypad edge が戻らない原因になります。明示的な AUDIO stop と自然終了 cleanup は分けて扱います。
7. それでも標準 WASM だけが止まる場合、実機寄り確認は外部エミュレーターを優先し、標準 WASM 側の制約として記録します。

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
