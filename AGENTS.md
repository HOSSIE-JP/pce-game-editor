# Codex 向け指示

このリポジトリは PC Engine / Super CD-ROM2 専用の `pce-game-editor` です。

## 作業の進め方

- 最初に `git status --short` と対象ファイルの差分を確認し、ユーザーの未コミット変更を保持してください。ゲーム制作では実在するプロジェクトパスと対象メディアを確認し、別作品やテンプレートを誤って上書きしないでください。
- 依頼は実行要求として扱い、通常の可逆な編集・調査・検証は自律的に完了してください。対象の取り違えや破壊的操作など、結果が大きく変わる不明点だけ確認してください。
- 重要な判断の前に目的・前提・影響範囲を見直し、完了前には反例・失敗条件・検証漏れを確認してください。無関係な整理や互換層を追加しないでください。
- 現行実装・テンプレート・実測を正とし、過去の記憶や古いビルド成功を現在の証拠にしないでください。資料とコードが食い違う場合は原因を調べ、同じ変更内で関連資料を更新してください。
- ゲーム制作とエンジン改善の手順は `docs/ai-development-workflow.md` を参照してください。作業に関係する資料だけを読み、毎回すべての資料や全エミュレーター検査を実行する必要はありません。
- 報告は日本語で簡潔に、変更内容・検証結果・未確認事項を示してください。ビルド、エミュレーター起動、画面、入力、音声、実機は別々の確認結果です。

## 最初に読むもの

- PCE プラグイン、アセット、ビルド、Test Play を変更する前に `PLUGIN.md` を読んでください。
- Test Play や実機/エミュレーター表示崩れを調査する前に `docs/pce-testplay-debugging.md` を読んでください。
- CD-ROM2 / VN runtime のメモリバンク配置を変更する前に `docs/pce-memory-bank-strategy.md` を読んでください。
- HuCARD VN のバンク配置・描画タイミングを変更する前に `docs/pce-vn-hucard-bank-layout.md` を読んでください。CD版の配置・音源処理をそのまま移植しないでください。
- VN runtime のコードが 3 常駐バンク(128/129/130)に収まらず溢れてビルド失敗したとき、退避候補の選定・測定・op-dispatch 退避・ハマりどころは `docs/pce-vn-code-bank-optimization.md`（最適化プレイブック）を読んでください。
- bank133 コードオーバーレイ(Path B)の link/抽出/dispatch 機構を追加・拡張するときは `docs/pce-vn-overlay-pathb.md` を読んでください。
- 公開 API、プラグイン manifest、IPC、ビルド仕様を変更する場合は、同じ作業内で `PLUGIN.md` または `docs/` 配下の関連ファイルを更新してください。
- ユーザーに見える機能追加・仕様変更・既知制約の追加を行う場合は、同じ作業内で `README.md`、`docs/user-guide.md`、`PLUGIN.md`、関連する `docs/` のいずれかを更新し、最終回答で更新したドキュメントを明記してください。
- 外部リポジトリからコードをコピーしないでください。外部情報は挙動理解だけに使い、実装は独自に行ってください。

## 現在の運用

- このエディタは開発中のため、基本的に過去データ・旧プロジェクト・旧仕様との互換性維持を優先しません。仕様変更時は現行テンプレートと現行データ形式を正とし、ユーザーから明示指示がない限り、互換レイヤー、旧設定の自動変換、旧プラグインの温存よりも実装の単純さと現在の設計を優先してください。
- PCE 固有の実装は `pce-*.js`、`plugins/pce-*`、`plugins/pc-engine-core`、`template/template_pce_*` を優先して確認してください。
- 共有アプリ基盤ユーティリティは本体に取り込んだ `game-editor-common.js` にあります（旧 `../game-editor-common` 外部パッケージは廃止）。
- PCE 固有のプロジェクト移行処理は `pce-project-migration.js` に置き、共通ライブラリへ戻さないでください。
- 画像アセットは内蔵 PCE 変換を使い、Superfamiconv には依存しません。
- CD-ROM2 は `targetMedia: "cd"` と `toolchain: "llvm-mos"` を前提に扱います。IPL / System Card はユーザー所有ファイルとして扱い、リポジトリへ同梱しません。
- CD-ROM2 の大きい画像/sprite/ADPCM payload と件数比例するmetadataはCD側へ置き、常駐RAMへ詰め込まないでください。現行配置は bank104–119 がvisual cache、bank123がscene pack、bank128/129/130が常駐コード、bank132がdirectory/scratch/cacheです。MPR4はbank130とbank121 visual・122 runtime support・124 logic・133 render overlayで時分割します。bank131はSystem Card、bank134/135はSystem Card PSG専用です。詳細とCD物理ファイル構成は `docs/pce-memory-bank-strategy.md` と `docs/pce-vn-overlay-pathb.md` を正としてください。
- bank128/129/130とbank124は各1024 bytes以上の空きを維持し、console RAM/ZP/NOLOAD/overlay relocationのbuild gateを緩めて通さないでください。空きは現在のELF/mapで測定し、未使用に見えるbankやcache領域を推測で転用しないでください。
- CD VNのPSGはSystem Card driverが所有し、VSync IRQの `PSG_DRIVE` は1回です。BGMはbank134、SFXはbank135へ別々にloadし、同じbusの再生中packageを上書きしないでください。古いdirect-MMIO PSGやcatch-up処理をCD版へ戻さないでください。
- VN runtimeへhelperを足す前に配置属性と呼出時のMPRを決めてください。bank128は起動・薄いdispatch・最小metadataに残します。処理本体は役割に合う既存overlayを検討し、別のslot4 bankへ直接call/relocationを作らずresident dispatcher経由でMPRを保存・復元してください。overlayから直接呼ぶresident helperはbank129または最小限のbank128へ置き、実行中に見えないbank130へ置かないでください。
- ADPCM の `divider` は音量ではなく ADPCM 再生 rate code です。`sampleRate` から `32000 / (16 - code)` に最も近い `0..15` の code を補完し、代表値は 32000Hz -> 15、16000Hz -> 14、8000Hz -> 12、4000Hz -> 8 です。旧実装で保存された `round(32000 / sampleRate - 1)` や `round(16000 / sampleRate - 1)` の値は読み込み時と runtime で補正します。
- ADPCM generated metadata の `codec`、`nibbleOrder`、`encoderVersion` が現行値と違う場合は source WAV から再生成してください。同じ `oki-msm5205/msn-first` 表記でも、古い `encoderVersion` のバイナリは先頭ノイズが出る可能性があります。
- ADPCM preload は ADPCM RAM への先読みだけです。`loaded_adpcm_valid` が立っていても、実際の再生時には必ず `pce_cdb_adpcm_play()` を呼んでください。
- VN runtime の短い ADPCM one-shot / buffered 再生は、再生開始後に毎フレーム `pce_cdb_adpcm_status()` で自然終了監視しないでください。標準 EmulatorJS/WASM core では、ADPCM 終了まで status polling した後に joypad edge が戻らないことがあります。
- VN runtime の ADPCM 自然終了後処理では、再生済みの one-shot に追加で `pce_cdb_adpcm_stop()` / `pce_cdb_adpcm_reset()` を投げないでください。明示的な AUDIO stop は stop/reset しますが、自然終了後の余分な reset は標準 EmulatorJS/WASM core で joypad edge が戻らない原因になり得ます。
- ADPCM 再生開始後の joypad edge 初期化では、現在押されている button を `last_pad` の baseline にしてください。`last_pad = 0` に戻すと、押しっぱなしの I/RUN が新規 edge として扱われ、`message.voiceAssetId` 付き message の typewriter が即 `finish_active_message()` でスキップされます。
- ADPCM 1 asset の安全上限は `min(65535, 65536 - adpcmAddress)` bytes です。4-bit ADPCM なので再生時間は概算で `bytes * 2 / sampleRate` 秒です。
- VN sprite 表示では generated `pce_editor_sprite_draw_meta[]` の compact metadata を使い、単一 frame/default animation は sheet 全体表示として扱います。VDC memory control は `VN_VDC_MEMORY_CONTROL` を使い、sprite cycle bit を落とさないでください。
- CD-ROM2 VN の BG `map_vram.bin` は `VN_MAP_WIDTH`(=32)タイル幅の「ソース行」として扱い、`mapBase` から一括転送しないでください。`width_tiles` 分だけを行単位でBATへ転送し、左右/上下余白は `clear_screen_map()` のblank tileを残します。画面は 256x224・BAT 32x32 で、BG 画像は 256px(32 タイル)以下にしてください。
- PCE の描画崩れ、VRAM/SATB/VDC レジスタ調査、Test Play の実画面デバッグでは、利用可能なら Geargrafx MCP を優先して使ってください。
- Codex の通常ツール一覧に Geargrafx MCP が見えない場合でも、Windows では `C:\homebrew\emulator\Geargrafx\Geargrafx.exe --headless --mcp-stdio` を直接起動し、stdio の JSON-RPC で調査できることがあります。Geargrafx 1.7.x の stdio MCP は 1 行 1 JSON の newline-delimited 形式で、`Content-Length` framing ではありません。最初に `initialize`、次に `tools/list` で schema を確認し、`load_media` は `file_path`、`controller_button` は `player` / `button` / `action` を渡してください。
- Geargrafx MCP で CD-ROM2 / CUE を検証するときは、`load_media` 後に `debug_continue` し、System Card 画面で RUN を入れてから実時間で十分待ってください。`debug_step_frame` だけで進めると CD boot や入力 edge の再現がずれ、PSG/ADPCM/VN script の実動作を誤判定しやすいです。PSG 調査では `get_psg_status`、bank 調査では `get_huc6280_status` の MPR を実動作確認に使ってください。
- Super CD-ROM2 / ADPCM の挙動確認では、標準 EmulatorJS/WASM だけを正としないでください。Geargrafx で正常動作し、標準 WASM だけが ADPCM 再生後に入力待ちから進まない場合があります。まず ADPCM あり/なしの比較、frame counter、`simulateInput()` 直接注入、読み込まれた core (`mednafen_pce-wasm.data` など) を確認し、runtime を壊す変更で回避しようとしないでください。
- Test Play の外部エミュレーター起動は `pce-external-emulator` plugin が担当します。プロジェクト設定の `testPlay.externalEmulator.executablePath` / `extraArgs` は、Test Play role が `pce-external-emulator` のときだけ有効です。macOS の Geargrafx 既定値は `/Applications/Geargrafx.app/Contents/MacOS/geargrafx` で、保存済み `.app` bundle path は main process で `Contents/MacOS` の実行ファイルへ解決してから ROM / CUE path を渡します。
- Electron renderer、preload、main process の責務を分離してください。
- ファイルシステム IPC はプロジェクトルート内に限定し、パストラバーサルを拒否してください。

## 回帰テスト

- コードを変更した後は、編集範囲に対応する最小限のテストを実行してください。
- PCE 全体の基本確認は `npm test` です。
- 文書・Codex設定だけの変更ではリンク・構文・差分を検証します。コード変更は対象テストから始め、共通処理やビルド仕様の変更では `npm test` と影響する実プロジェクトのビルドまで進めてください。検証済みの範囲を理由なく繰り返さないでください。
- テストを実行できない場合は、その理由と残るリスクを最終回答に書いてください。

## コミットメッセージ

Codex がこのリポジトリでコミットを作成する場合、コミットメッセージは日本語で書いてください。
