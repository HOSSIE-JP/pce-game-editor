# 公開時の外部依存・ライセンス監査

監査日: 2026-07-27

この文書は、現行の `package.json` / `package-lock.json`、SetUp、Build、
Test Play、Export、Windows 配布物を基準に、利用者が用意するものと
PCE Game Editor が再配布する第三者コンポーネントを分離したものです。

## 利用機能ごとの前提

| 利用機能 | 必要な外部要素 |
| --- | --- |
| HuCard Build | `llvm-mos-sdk` |
| HuCard 標準 Test Play | `EmulatorJS` と `mednafen_pce` core |
| HuCard 外部 Test Play | 任意の外部エミュレーター。EmulatorJS は不要 |
| HuCard itch.io HTML5 Export | `EmulatorJS` と `mednafen_pce` core。公開時は対応ソースの提供も必要 |
| CD-ROM2 Build | `llvm-mos-sdk`、ユーザー所有 IPL。Windows の `pce-mkcd.exe` は下記 MinGW DLL も必要 |
| CD-ROM2 標準 Test Play | 上記 Build 要件、`EmulatorJS` / `mednafen_pce`、日本版 Super System Card 3.0 ROM |
| CD-ROM2 外部 Test Play | 上記 Build 要件、日本版 Super System Card 3.0 ROM、任意の外部エミュレーター |

System Card ROM は CD-ROM2 のビルド自体には使わず、Test Play 前の
profile 検証とエミュレーター起動にだけ使います。IPL、System Card、
外部エミュレーターはアプリや生成物に同梱しません。

## 取得と利用の経路

### llvm-mos-sdk

SetUp は GitHub Releases API から現在のOS/CPUに合う配布 archive を列挙し、
ユーザーが `DL` を押した場合だけ、Electron の `userData/tools` 配下へ
ダウンロード・展開します。既存の `mos-pce-clang` を手動指定することも
できます。HuCard では `mos-pce-clang`、CD-ROM2 では
`mos-pce-cd-clang`、`pce-mkcd`、`llvm-objcopy` など同じ SDK の
companion tool を使います。

SDK の主ライセンスは Apache-2.0 WITH LLVM-exception です。SDK 自体には
別ライセンスのファイルもあり、SDK を再配布する場合は配布物内の
`LICENSE` と個別の license marker をそのまま確認・保持してください。
PCE Game Editor の配布物には SDK を含めません。

### EmulatorJS / mednafen_pce

SetUp は EmulatorJS CDN の release index と GitHub Releases を候補として
表示し、ユーザー操作時だけ `userData/tools` 配下へ取得します。標準
Test Play はその runtime をローカル HTTP server から読み込みます。

EmulatorJS は GPL-3.0、`mednafen_pce` / Beetle PCE core は
GPL-2.0-only です。アプリ本体には含めませんが、itch.io HTML5 Export
には両方の binary が入るため、Export ZIP 内の license/notice だけでなく、
同梱版に正確に対応する完全なソース、変更、build script を公開者が
同じ配布場所から無償取得できるようにする必要があります。

### PCE-CD IPL / System Card

IPL はユーザー所有の ISO/CUE/BIN から SetUp のウィザードで先頭
data sector を抽出するか、所有する `ipl.bin` を指定します。System Card
ROM はファイル選択で指定し、CD VN Test Play 前に日本版 v3 profile を
検証します。いずれも repository、アプリ、ROM/CUE/ISO、HTML Exportへ
コピーしません。

### Windows の pce-mkcd MinGW runtime

現行の Windows `pce-mkcd.exe` は次の3ファイルを動的に必要とします。

- `libstdc++-6.dll`
- `libgcc_s_seh-1.dll`
- `libwinpthread-1.dll`

ビルド直前に3ファイルが `pce-mkcd.exe` と同じ directory にあるか確認し、
不足時は `MINGW_PREFIX`、`C:\msys64` / `C:\msys2`、Git for Windows、
`PATH` の順で「3点が揃った同一 directory」を探してコピーします。
見つからない場合だけ CD-ROM2 Build を明示的なエラーで止めます。
つまり Git for Windows / MSYS2 / MinGW は HuCard の前提ではなく、
Windows CD-ROM2 Build で SDK 配布物に DLL が無い場合だけ発生する
追加前提です。

PCE Game Editorは`git` / `git.exe`コマンドを実行しません。Git for Windowsは
上記DLLのコピー元候補として既知のdirectoryを参照するだけです。
DLLが`pce-mkcd.exe`の隣、MSYS2 / MinGW、またはPATH上のdirectoryに
揃っていればGit for Windowsの導入は不要です。

これらの DLL は PCE Game Editor からダウンロード・再配布しません。
将来アプリ側へ同梱する場合は、使用した MinGW/GCC 配布物の license、
GCC Runtime Library Exception、対応ソース提供条件を別途確定してください。

### archive 展開と VN font

Windows の `tar.exe` は OS 標準機能として ZIP / 7z を展開できるため、
SetUp に `pwsh.exe`、`tar.exe`、System.Drawing の成功行は表示しません。
archive 展開処理では Windows `tar` を最初に試し、失敗時だけ
Windows PowerShell、7-Zip、`unzip` などへフォールバックします。
`pwsh.exe`（PowerShell 7）自体は Windows の必須前提ではありません。

HuCard VN の custom font は Windows では Windows PowerShell と
System.Drawing、その他のOSでは Python 3 + Pillow を利用できます。
どちらも無い場合は内蔵 fallback bitmap で生成を継続するため、厳密な
実行前提ではありません。ただし Windows 以外で実フォント形状を使う
HuCard VN には Python 3 + Pillow を推奨します。CD VN の本文/SpriteText
は System Card `EX_GETFNT` を使い、この依存はありません。FFmpeg と
Superfamiconv は使用しません。

## アプリに同梱する内部依存

PCE Game Editor本体はCopyright (c) 2026 HOSSIEのMIT Licenseです。
MITは本体の利用・改変・再配布を許可しますが、著作権表示と許諾表示を
コピーまたは重要な部分へ残す必要があります。無保証条項も含みます。
本体のMITは、以下の第三者コンポーネントをMITへ変更しません。
`package.json`の`private: true`はnpm registryへの誤公開を防ぐ設定であり、
GitHubでのソース公開、デスクトップアプリ配布、MIT Licenseの効力を
妨げません。

| Component | Version | 用途 | License / 対応 |
| --- | --- | --- | --- |
| Electron | 41.3.0 | desktop runtime | MIT。配布物の `LICENSE.electron.txt` と `LICENSES.chromium.html` を保持 |
| iconv-lite | 0.6.3 | Shift-JIS encode | MIT。`licenses/iconv-lite-MIT.txt` を同梱 |
| safer-buffer | 2.1.2 | iconv-lite の runtime dependency | MIT。`licenses/safer-buffer-MIT.txt` を同梱 |
| electron-builder | 26.8.1 | package作成時だけ | MIT。runtimeには入らない。source/build配布向けにlicenseを保持 |

独自実装の PNG/BMP/WebP 変換、WAV/ADPCM、MIDI/VGM parser、ZIP writer は
外部 npm runtime library ではありません。Electron が内部に含む Chromium、
Node.js、FFmpeg 等の notices は electron-builder が配置する
`LICENSES.chromium.html` に集約されています。

アプリ配布物には `THIRD_PARTY_NOTICES.md` と `licenses/` も明示的に含め、
About から開けるようにします。`node_modules` 内に偶然 license が残ること
だけへ依存しません。

## 公開前チェック

1. Windows/macOS package に `THIRD_PARTY_NOTICES.md`、`licenses/`、
   Electron の2つの license file があることを確認する。
2. app archive 内の `iconv-lite` / `safer-buffer` の版と、この文書の版を
   dependency 更新時に揃える。
3. itch.io HTML5 ZIP を公開する場合は、生成された `SOURCE.md` が要求する
   exact source archive を同じ公開ページへ置く。
4. IPL、System Card、取得済み EmulatorJS、llvm-mos SDK、MinGW DLL を
   PCE Game Editor の binary packageへ混入させない。
5. `LICENSE`、`package.json`、配布物の著作権表示を
   Copyright (c) 2026 HOSSIE / MITで一致させる。
6. `build/icon.*`、`template/`、`samples/`に含む画像・音声などについて、
   HOSSIEがMITで配布できる権利を持つか、公開前に由来を確認する。
   第三者素材がある場合はMIT対象から明示的に除外し、個別のcredit/licenseを
   そのファイルまたはasset noticeへ追加する。
7. MITはPC Engine / TurboGrafx等の商標、ユーザーが取り込んだ素材、
   ユーザー所有のfirmwareに権利を付与しないことを公開説明で混同しない。
