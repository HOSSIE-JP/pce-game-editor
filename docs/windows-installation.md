# Windows版の導入

Windows x64向けの自己展開exeとZIP版をGitHub Releasesで配布します。
アプリ本体の起動にNode.js、npm、Git、開発環境の構築は不要です。

## ダウンロードと起動

1. 招待を受諾したGitHubアカウントで [Releases](https://github.com/HOSSIE-JP/pce-game-editor/releases) を開きます。privateリポジトリでは、ログアウト中や閲覧権限がないアカウントには404が表示されます。
2. 対象バージョンの **Assets** を開き、`PCEGameEditor-<version>-Portable-x64.exe` をダウンロードします。`Source code` は開発者用です。
3. ダウンロードしたexeをダブルクリックします。必要なファイルを一時フォルダーへ展開してから起動するため、少し待ちます。インストール操作や管理者権限は不要です。よく使う場合は、このexeへのショートカットを自分で作成できます。
4. 同じReleaseの `SHA256SUMS.txt` でダウンロードしたファイルのSHA-256を照合できます。PowerShellでは `Get-FileHash -Algorithm SHA256 '<ダウンロードしたexeのパス>'` を使います。

コード署名を付けていない配布版では、Windowsに発行元不明と表示される場合があります。
配布元とSHA-256を確認してください。組織のアプリ実行ポリシーで拒否された場合は管理者に相談してください。

起動のたびの自己展開を省く場合は `PCEGameEditor-<version>-win-x64.zip` を、任意のフォルダーへ**すべて展開**し、`PCEGameEditor.exe` を起動します。
ZIP内のexe単体では動きません。同じフォルダーのDLL、`resources`、ライセンス文書も必要です。

## 初回のSetUp

アプリの **SetUp** から、使う機能に必要なものを取得・指定します。

| 目的 | SetUpで行うこと |
| --- | --- |
| HuCARDのゲームをビルドする | `llvm-mos-sdk` のWindows向けバージョンを選び、`DL`を押す |
| 標準エミュレーターでTest Playする | `EmulatorJS / mednafen_pce` のバージョンを選び、`DL`を押す |
| CD-ROM2をビルドする | SDKに加え、所有するCDイメージからIPLを抽出するか、所有するIPLファイルを指定する |
| CD-ROM2 VNをTest Playする | 上記に加え、日本版Super System Card 3.0の所有ROMを指定する |
| 外部エミュレーターでTest Playする | 外部エミュレーターを各自導入し、プロジェクトのTest Play設定で実行ファイルを指定する |

取得にはインターネット接続が必要です。既に導入済みなら各カードの手動パス欄から指定できます。
SDK、エミュレーター、IPL、System Cardはアプリの配布ファイルに含まれません。
CD-ROM2ビルドでは指定したIPLの先頭2048 bytesが生成ISOへ入ります。
所有ファイルを指定できることと、そのIPLを含むCDを第三者へ再配布できることは別です。
ゲームのCD配布前にはIPLの再配布条件も確認してください。

Windows CD-ROM2ビルドで、`pce-mkcd.exe`用の`libstdc++-6.dll`、`libgcc_s_seh-1.dll`、
`libwinpthread-1.dll`が不足する場合だけ、MinGW／MSYS2等の導入が追加で必要です。
ビルドログに不足が表示されます。エディターは既存のMinGW、MSYS2、Git for Windows、PATHから
3点が揃うセットを探します。無関係なDLL配布サイトから取得せず、[依存関係の詳細](release-dependencies-and-licenses.md)に従ってください。
HuCARDのビルドにはこれらのDLLは不要です。

準備後、**新規プロジェクト**でゲームタイプと保存場所を選びます。
最初の動作確認にはIPLやSystem Cardが不要なHuCARDサンプルを利用できます。
CD-ROM2プロジェクトでは、Sound > CD-DAでTrack 1用の警告音声も自分で設定してからビルドします。
詳しい編集・ビルド操作は [User Guide](user-guide.md) を参照してください。

## 保存先と更新

自己展開exe版・ZIP版とも、既定ではElectronのユーザーデータフォルダー
（通常 `%APPDATA%\PCEGameEditor`）へ設定、ログ、ダウンロードしたtools等を保存します。
プロジェクトは新規作成時に選んだ場所へ保存します。一時展開先やZIP内の`resources`を編集しないでください。

更新時はアプリを終了し、プロジェクトをバックアップしてから新しい自己展開exeを起動します。旧exeは不要になれば削除できます。
ZIP版は別フォルダーへ展開して起動します。既存のプロジェクトは「プロジェクトを開く」から選びます。

ZIP版では、展開した`PCEGameEditor.exe`と同じ場所に`portable`というファイルまたはフォルダーを手動で置くと、
その場所の`data`へ保存する従来のポータブルモードを選べます。
配布物にこのマーカーは自動同梱しません。ポータブルモードを使う場合はアプリのフォルダー全体を
書き込み可能な場所へ置き、更新時は`data`も保存してください。
自己展開exe版は毎回一時フォルダーで動くため、このマーカーによる保存先変更にはZIP版を使ってください。

## ライセンス

アプリ本体は [MIT License](../LICENSE) です。第三者のライセンス原文と著作権表示を同梱し、
Aboutから参照できます。private配布はGitHubへのアクセス制限であり、MITが受領者に許可する
再配布・改変の権利を取り消すものではありません。
第三者ソフト、フォント、所有ファームウェアの条件は [Third-Party Notices](../THIRD_PARTY_NOTICES.md) に記載しています。

GitHubのRelease閲覧権限については [GitHub公式説明](https://docs.github.com/en/repositories/releasing-projects-on-github/about-releases)、
MITの条件については [OSIのライセンス原文](https://opensource.org/license/mit) を参照してください。
