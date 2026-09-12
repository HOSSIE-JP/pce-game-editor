# 公開時の外部依存・ライセンス監査

監査日: 2026-09-12

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
| PCE VN GB Studio出力 | GB Studio 4.3.1 / engine `4.3.0-e1`。公式build modeでは指定した本体を隔離profileで起動 |

System Card ROM は CD-ROM2 のビルド自体には使わず、Test Play 前の
profile 検証とエミュレーター起動にだけ使います。IPL、System Card、
外部エミュレーターはアプリ配布物に同梱しません。生成CDのIPLは下記の別条件です。

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
検証します。いずれもrepositoryとアプリ配布物へは同梱しません。

CD Buildは`pce-build-system.js`から`pce-mkcd --ipl <path>`を呼び出します。
[pce-mkcdの公式実装](https://github.com/llvm-mos/llvm-mos-sdk/blob/main/utils/pce-mkcd/pce-mkcd.cc)
は指定IPLの2048 bytesをISOのsector 0へ書き込むため、生成CDにはその内容が含まれます。
現行のHTML ExportはHuCARD専用でCDプロジェクトを拒否します。System Card ROM自体は
生成ゲームやHTML Exportにコピーしません。

[llvm-mosのPCE資料](https://llvm-mos.org/wiki/PCE_target#Building_an_ISO)は、
SDKにIPLを再配布する許可がないためユーザーが用意する必要があると説明しています。
元ディスクを所有していることとIPLを含む生成CDの再配布許諾は別です。公開するゲームの
IPL・取り込み素材の再配布条件は、アプリのMIT Licenseでは付与されません。

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

### GB Studio exporterとMisaki Gothic

現行のGB Studio変換と配布ライセンス管理は、スタンドアロン
`C:\homebrew\projects\pce-2-gb-novelgame-converter`へ移管しました。以下は移管受入の
parity・公式build/runtime・Portable write監査が完了するまでPCE Game Editorに一時保持する
旧`pce-vn-gb-studio-exporter`の依存記録です。旧pluginを撤去するまでは`@electron/asar`、
Misaki Gothicと各noticeをPCE Game Editor配布物から先に削除してはいけません。

`pce-vn-gb-studio-exporter`はユーザーが指定したGB Studio 4.3.1の
`app.asar` metadataとengine versionを読み、公式build modeだけ本体を隔離profileで
起動します。GB Studio本体やengine sourceをPCE Game Editorへコピー・再配布しません。
ユーザー指定の外部ProTracker MODとcustom fontも、変換成功後にPCE project内へ
portable copyを保存しますが、その素材の権利とライセンスはユーザー側に残ります。

既定fontのMisaki Gothic 8x8は2021-05-05版、Copyright (C) 2002-2021
Num Kadomaです。組み込みBDF sourceのSHA-256は
`28a8745552c844f7c73f11bdf4470225f5e08645a98c5404b2e25bb326a5cabd`、
原文licenseのSHA-256は
`82929cc3b34c79b6a67f21fe137c7bb165589c9e34ba1441611e493afd67dfca`です。
原文は`third_party/misaki-font/LICENSE.txt`へ保持します。利用・複製・改変・商用を含む
再配布が無制限に許可され、無保証です。desktop packageと生成GB Studio projectの双方へ
licenseを同梱します。配布元として原文記載の`http://littlelimit.net/`を保持します。

### CD VNテンプレートのJFドット東雲明朝12

`template/template_pce_vn_cd/assets/fonts/JF-Dot-ShinonomeMin12.ttf`は
Version `1.00.20150527`、SHA-256
`75ff065a49fdd352eecffc140a88e728c81fc1578ddc31957c3df54dabe0301d`です。
この実ファイルのOpenType name table（name ID 13、platform 3、language 1041）に
含まれる許諾は、改造・形式変換・組込み・再配布を認める実質Public Domain宣言です。
原文を改変せず`licenses/JF-Dot-ShinonomeMin12-Public-Domain.txt`と
テンプレートの`assets/fonts/LICENSE-JF-Dot-ShinonomeMin12.txt`へ保持しました。

原作者はThe Electronic Font Open Laboratory、TrueType化は自家製フォント工房です。
埋込情報の配布元URL、検証日、抽出方法はフォント隣の`README.md`で追跡できます。
公式配布サイトは今回の確認時に取得できなかったため、現在同梱されているTTF自身の
許諾情報を根拠にしています。本体のMITとして再表示する対象ではありません。

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
| @electron/asar | 3.4.1 | GB Studio本体のversion/engine metadata検査 | MIT。`licenses/electron-asar-MIT.txt`を同梱 |
| balanced-match | 1.0.2 | @electron/asarの間接runtime依存 | MIT。`licenses/balanced-match-MIT.txt`を同梱 |
| brace-expansion | 1.1.14 | @electron/asarの間接runtime依存 | MIT。`licenses/brace-expansion-MIT.txt`を同梱 |
| minimatch | 3.1.5 | @electron/asarの間接runtime依存 | ISC。`licenses/minimatch-ISC.txt`を同梱 |
| commander | 5.1.0 | @electron/asarの間接runtime依存 | MIT。`licenses/commander-MIT.txt`を同梱 |
| concat-map | 0.0.1 | @electron/asarの間接runtime依存 | MIT。`licenses/concat-map-MIT.txt`を同梱 |
| fs.realpath | 1.0.0 | @electron/asarの間接runtime依存 | ISC。`licenses/fs.realpath-ISC.txt`を同梱 |
| glob | 7.2.3 | @electron/asarの間接runtime依存 | ISC。`licenses/glob-ISC.txt`を同梱 |
| inflight | 1.0.6 | @electron/asarの間接runtime依存 | ISC。`licenses/inflight-ISC.txt`を同梱 |
| inherits | 2.0.4 | @electron/asarの間接runtime依存 | ISC。`licenses/inherits-ISC.txt`を同梱 |
| once | 1.4.0 | @electron/asarの間接runtime依存 | ISC。`licenses/once-ISC.txt`を同梱 |
| path-is-absolute | 1.0.1 | @electron/asarの間接runtime依存 | MIT。`licenses/path-is-absolute-MIT.txt`を同梱 |
| wrappy | 1.0.2 | @electron/asarの間接runtime依存 | ISC。`licenses/wrappy-ISC.txt`を同梱 |
| iconv-lite | 0.6.3 | Shift-JIS encode | MIT。`licenses/iconv-lite-MIT.txt` を同梱 |
| safer-buffer | 2.1.2 | iconv-lite の runtime dependency | MIT。`licenses/safer-buffer-MIT.txt` を同梱 |
| @audio/encode-ogg | 1.2.2 | Godot package用Ogg Vorbis encode | MIT。`licenses/audio-encode-ogg-MIT.txt` を同梱 |
| wasm-media-encoders | 0.7.0 | encode-oggへbundleされたWASM bridge | MIT。`licenses/wasm-media-encoders-MIT.txt` を同梱 |
| @swc/helpers | 0.5.23 | encode-oggへbundleされたJS helper | Apache-2.0。`licenses/swc-helpers-Apache-2.0.txt` を同梱 |
| libogg | 1.3.4 | Ogg container encode（WASMへ静的組込） | BSD-style。`licenses/libogg-1.3.4-BSD.txt` を同梱 |
| libvorbis | 1.3.7 | Vorbis encode（WASMへ静的組込） | BSD-style。`licenses/libvorbis-1.3.7-BSD.txt` を同梱 |
| Misaki Gothic | 2021-05-05 | GB Studio exporter既定8x8日本語font | Misaki Font License。`third_party/misaki-font/LICENSE.txt`を同梱 |
| JF Dot Shinonome Mincho 12 | 1.00.20150527 | CD VNテンプレートのcustom font | 実質Public Domain宣言。`licenses/JF-Dot-ShinonomeMin12-Public-Domain.txt`とフォント隣の原文を同梱 |
| electron-builder | 26.8.1 | package作成時だけ | MIT。runtimeには入らない。source/build配布向けにlicenseを保持 |

`@electron/asar`の間接依存12種は、実際にインストールされた固定版の
`package.json`とライセンス原文を確認し、原文の内容を変えず`licenses/`へ複製しました。
`licenses/runtime-transitive-sources.json`は元のnpmパス・版・複製先・SHA-256を記録します。
`balanced-match`、`brace-expansion`、`minimatch`の`glob`配下にある重複コピーも
同版・同じ許諾原文です。最終パッケージでは、中央noticeとともにnpm内の元のLICENSEも
保持されることを検証してください。

独自実装の PNG/BMP/WebP 変換、PCM WAV/ADPCM、MIDI/VGM parser、ZIP writer は
外部 npm runtime library ではありません。Godot出力のWAV→Ogg Vorbis変換だけは
上表のWASM encoderを使います。`@audio/encode-ogg`はOgg専用の自己完結bundleで、
下位npm packageに同梱された未使用MP3 encoderはdesktop packageから除外します。
Electron が内部に含む Chromium、
Node.js、FFmpeg 等の notices は electron-builder が配置する
`LICENSES.chromium.html` に集約されています。

アプリ配布物には `THIRD_PARTY_NOTICES.md` と `licenses/` も明示的に含め、
About から開けるようにします。`node_modules` 内に偶然 license が残ること
だけへ依存しません。

### Electron内蔵FFmpegの対応ソース

Windows配布物の`ffmpeg.dll`はLGPL-2.1-or-laterです。Electron `v41.3.0`のDEPSから
Chromium `146.0.7680.188`、さらに同版ChromiumのDEPSからFFmpeg revision
`ae11d2ba5c835b822a61d6a99eeb853ca30d41d8`を確定しました。FFmpegソースの
`chromium/config/Chrome/win/x64/config.h`で`CONFIG_GPL=0`、`CONFIG_NONFREE=0`、
`CONFIG_VERSION3=0`、LGPL 2.1 or later表示を確認しました。

同じ[Releaseページ](https://github.com/HOSSIE-JP/pce-game-editor/releases/tag/v0.4.1)から
FFmpeg全ソース、Electronの同tagソース（patch・release/all.gn・公式build手順を含む）、
同版Chromium build scripts、Opus/NASMの固定ソース、GN支援ファイルを無償取得できるようにします。
原文LGPLは`licenses/FFmpeg-LGPL-2.1.txt`、取得先・版・変更・差替え権利は
`licenses/Electron-FFmpeg-SOURCE.md`に保持します。アプリ本体のMITは、互換DLLへの差替えや、
LGPL対象ライブラリの改変をデバッグするためのリバースエンジニアリングを制限しません。

配布資料の`THIRD_PARTY_SOURCE_MANIFEST.json`に公式URL、archiveのSHA-256、ローカルで
パッケージ作成に使う`ffmpeg.dll`のSHA-256を記録しました。ソースarchiveのtar一覧、
設定、支援ファイル7個のGit blob hashを検証しました。Electron自体の再ビルドは行っておらず、
同一バイナリの再現性や全Chromium依存のオフライン同梱を確認したものではありません。
GN buildには公式手順による固定DEPSのcheckoutとWindows開発ツールが必要です。

## 公開前チェック

今回のソース監査で同梱フォント・npm間接依存の表示を補いました。画像・音声の権利由来、
最終exe/ZIPの内容検査、インストール・起動の確認は別の公開判定です。

1. Windows配布時は対応ソースarchive・`THIRD_PARTY_SOURCES.md`・source manifestを
   exe/ZIPと同じReleaseへ添付し、最終`ffmpeg.dll`がsource manifestのhashと一致するか確認する。
   Windows/macOS package に `THIRD_PARTY_NOTICES.md`、`licenses/`、
   Electron の2つの license file があることを確認する。
2. app archive 内の `iconv-lite` / `safer-buffer` / `@audio/encode-ogg` の版と、
   未使用の`wasm-media-encoders` packageが除外されていること、この文書の版を
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

## 許諾条件の一次資料

- [Electron MIT License](https://github.com/electron/electron/blob/main/LICENSE)
- [GNUライセンスFAQ: バイナリに対応するソースの提供](https://www.gnu.org/licenses/gpl-faq.en.html#UnchangedJustBinary)
- [FFmpegの配布ライセンスと法的事項](https://www.ffmpeg.org/legal.html)

Electronが内包する第三者コードの扱いは、最終的に使用したElectron配布物の
`LICENSES.chromium.html`と一致させます。独立したFFmpeg実行ファイルを追加する場合は、
LGPL/GPL/nonfreeの実ビルド条件と対応ソースを別途検証する必要があります。

## Windows自己展開EXEのランチャー

Windows版はelectron-builder 26.8.1のportable targetを使います。
`portable.useZip: true`でアプリをNSISの`File /r`により直接埋め込み、
NSIS 3.0.4.1のzlib/Deflateで展開します。NSIS runtime/標準pluginはzlib/libpngで、
`licenses/NSIS-COPYING.txt`に原文を保持します。COPYING内のCPL 1.0と
link例外は任意のLZMA圧縮module向けで、今回のzlib構成では使用しません。
ビルドツールのlicenseと生成EXEに実際に埋め込む部品のlicenseを分けて確認します。

StdUtils 1.14（Unicode DLL file version 1.1.4.0）は起動引数の受け渡しに使います。
LGPL-2.1-or-laterで、作者は未改変DLLをNSIS plugin interface経由で使うinstallerを
libraryの派生物ではなく「libraryを使うwork」と説明しています。
公式配布DLLと使用するresource bundle内DLLのSHA-256はともに
`b72e9013a6204e9f01076dc38dabbf30870d44dfc66962adbf73619d4331601e`です。

対応ソース`StdUtils.2018-10-27.sources.tbz2`とportableランチャーの
再結合用metadata/configuration/NSIS templatesを同じReleaseへ添付します。
配布ZIPのアプリobjectを`--prepackaged`へ指定し、Unicode x86の
StdUtils.dllをresource directoryで差し替えて再構築できる手順を
`licenses/NSIS-StdUtils-SOURCE.md`に記載しました。MITはLGPL部品の改変・
差し替え・改変デバッグ目的のreverse engineeringを制限しません。
アプリのprivate source repositoryや署名鍵はこの再結合に不要です。
StdUtilsの再コンパイルと旧Visual Studio環境での再現は今回の監査では未実施です。

StdUtils内のRHash、BLAKE2（CC0）、旧Apache Base64の原文帰属/許諾も
`licenses/StdUtils-*`へ保持します。Apache原文の要求する謝辞は
`THIRD_PARTY_NOTICES.md`にも記載します。

既定installerの調査ではWinShellは作者のNSISページにFreewareとだけ記載され、
公式ZIPに個別の再配布許諾文がありませんでした。この部品を採用しないportable構成で
公開します。WinShell、UAC、nsis7z、elevate.exeは最終配布に含めません。
調査用に取得した未使用部品のarchivesはRelease assetから除外します。
最終生成物のNSIS埋込ファイル一覧でも除外を確認することが公開の検証条件です。

出典:
- [NSIS License](https://nsis.sourceforge.io/License)
- [StdUtils作者の許諾とNSIS interfaceの説明](https://nsis.sourceforge.io/StdUtils_plug-in)
- [StdUtils 1.14公式source/binary](https://github.com/lordmulder/stdutils/releases/tag/1.14)
- [WinShell作者の配布ページ](https://nsis.sourceforge.io/WinShell_plug-in)
- [electron-builder 26.8.1のportable template](https://github.com/electron-userland/electron-builder/blob/v26.8.1/packages/app-builder-lib/templates/nsis/portable.nsi)
