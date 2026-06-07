# PCE Test Play Debugging

このメモは、PC Engine / Super CD-ROM2 の Test Play や描画崩れを Codex が調査するときの運用です。

## 基本方針

- PCE の画面荒れ、波打ち、タイル化け、スプライト化けは、利用可能なら Geargrafx MCP でデバッグします。
- EmulatorJS / ブラウザーキャプチャは再現確認やユーザー向け見た目確認に使い、原因特定は Geargrafx MCP の VDC / VRAM / SATB / palette 情報を優先します。
- CD-ROM2 は `targetMedia: "cd"` と `toolchain: "llvm-mos"` 前提です。System Card / IPL はユーザー所有ファイルとして扱い、リポジトリへ同梱しません。
- Geargrafx MCP がこのセッションで見えない場合は、まず MCP ツール discovery と接続状態を確認し、それでも使えないときだけ Electron Test Play キャプチャを暫定手段にします。

## 推奨手順

1. `PLUGIN.md` とこのファイルを読み、変更対象が PCE runtime / asset / build / Test Play のどこかを切り分けます。
2. 対象プロジェクトを通常のビルド経路でビルドし、`.cue` / `.pce` の出力を確認します。
3. Geargrafx MCP で出力 ROM / CUE を起動し、ゲーム開始後の問題フレームまで進めます。
4. VDC control register を確認し、DRAM refresh、VRAM increment、BG / sprite enable が意図通りかを見ます。
5. BG map、tile VRAM、font/UI tile 領域、palette bank を確認し、マップが参照しているタイル番号と実データが一致しているかを見ます。
6. スプライト化けでは SATB の `x` / `y` / `pattern` / `attr`、sprite pattern VRAM、sprite palette を合わせて確認します。
7. 修正後は Geargrafx MCP で同じフレームを再確認し、必要なら Electron Test Play でもユーザーが見る画面をキャプチャします。

## 見るべき典型ポイント

- 波打ちや画面全体の破綻: VDC control の DRAM refresh が表示切り替え時にも保持されているか。
- BG の崩れ: `tileBase * 16`、map base、VRAM copy destination、map word の palette bank / tile index。
- UI / font の縦縞: 空白タイルの VRAM 内容、font tile base、UI palette bank、window fill map。
- スプライト崩れ: SATB の pattern 値、pattern VRAM destination、16x16 pattern のエンコード順、width / height attr。
- CD-ROM2 固有の差: BIOS helper 経由の SATB 更新、VDC copy mode、banked asset の RAM bank 切り替え。

## 回帰確認

- コード変更後は編集範囲に対応する最小限のテストを実行します。
- PCE 全体の基本確認は `npm test` です。
- 画面系の修正では、テストだけでなく Geargrafx MCP か Test Play キャプチャで実画面を確認します。
