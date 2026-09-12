# Windows 版のビルド (自己展開exe / zip)

PC Engine Game Editor の Windows 配布物をビルドする手順と、Windows 固有のハマりどころ
(winCodeSign の symbolic link 権限問題) をまとめる。

## コマンドと成果物

| コマンド | 生成物 | 説明 |
| --- | --- | --- |
| `npm run build:win` | `dist/PCEGameEditor-<version>-Portable-x64.exe` と `dist/PCEGameEditor-<version>-win-x64.zip` | Windows x64の自己展開exeとZIPを同時生成 |
| `npm run build:win:exe` | `dist/PCEGameEditor-<version>-Portable-x64.exe` | 自己展開exeのみ |
| `npm run verify:dist` | 監査結果を標準出力へ表示 | `dist/win-unpacked` の同梱内容を検査 |

VSCode からは Tasks (`Ctrl+Shift+P` → "Tasks: Run Task") の
「**Windows EXE をビルドして zip 作成**」でも同じ `build:win` を実行できる。
`electron-builder.yml` の `win.target` でportableとZIPを指定しているため、
自己展開exeと展開用ZIPを1コマンドで作成する。
portableは通常ユーザー権限で動き、`useZip: true`によりNSIS内蔵の展開方式を使う。
標準インストーラーのWinShell部品は再配布許諾の詳細を確認できなかったため使用しない。

配布物には`portable`マーカーを入れない。自己展開exe版・ZIP版とも既定ではElectronの
ユーザーデータフォルダーを使い、インストール先に設定やツールを書き込まない。
ZIP利用者が手動で`portable`マーカーを置く従来機能は残る。
利用者向け手順は [Windows版の導入](windows-installation.md) を参照。

## 配布前の検証とGitHub Release

1. 未コミット変更を確認し、今回配布する変更だけを確定する。本体version、package-lockのversion、Release tagを揃える。
2. `npm ci`でロックされた依存を用意し、`npm test`を実行する。既に同じlockで準備済みなら再インストールは不要。
3. `npm run build:win`を実行する。`afterPack`の `scripts/verify-distribution.js` がアプリ内の許可範囲、個人data／SDK／BIOS／ゲーム媒体の混入、テンプレート、build metadata、ライセンス原文の完全一致を検査する。
4. 最終exeとZIPについて、Electronの`LICENSE.electron.txt`、`LICENSES.chromium.html`が残っていること、初回起動、テンプレート作成、SetUpの導線を確認する。テスト通過、実行確認、実ゲームのビルド、音声・実機確認を区別して記録する。
5. [外部依存・素材の監査](release-dependencies-and-licenses.md)を確認し、Releaseに添付するファイルのSHA-256を`SHA256SUMS.txt`へ記録する。配布元commit、version、各assetのサイズ／SHA-256も`release-manifest.json`へ残す。
6. **招待済み利用者向け配布では、アップロード前にGitHub APIで対象リポジトリの`private: true`を確認する。** `package.json`の`private: true`はGitHubの公開範囲を設定しない。publicの場合はReleaseの公開を止める。
7. 対象commitから`v<version>`のtagを作り、GitHub Releaseへ自己展開exe、ZIP、ハッシュ、manifest、導入ガイド、第三者noticeを添付する。`dist`全体や`data`、開発用ログ、SDKキャッシュは添付しない。
8. Releaseのtag／commit、asset名／サイズ／digestとローカル成果物のSHA-256を照合してから完了とする。

コード署名証明書を設定していない場合は未署名版として案内する。ライセンス文書やSHA-256は
署名の代わりではなく、Windowsの発行元表示を認証済みに変更するものでもない。

GitHub CLIの認証は`gh auth status`で確認する。トークンをコード、Release本文、ログに書かない。
privateリポジトリのReleaseは閲覧権限がある利用者だけが取得できるが、同じ利用者にはソースと
GitHubが自動提供するSource code archiveも見える。MITの再配布許可も引き続き適用される。

## winCodeSign の symbolic link 問題 (Windows 固有)

### 症状
`npm run build:win` が次のエラーで失敗する。

```
⨯ cannot execute  cause=exit status 2
  ERROR: Cannot create symbolic link : クライアントは要求された特権を保有していません。 :
    ...\Cache\winCodeSign\<id>\darwin\10.12\lib\libcrypto.dylib
  command='...\7zip-bin\win\x64\7za.exe' x -snld -bd '...winCodeSign-2.6.0.7z' ...
```

ログ上は `updating asar integrity executable resource` → `winCodeSign-2.6.0.7z` の
ダウンロード直後に発生する。

### 原因
- electron-builder は exe へアイコン/バージョン情報を書き込む **rcedit** と、署名用の
  **signtool.exe** を `winCodeSign-2.6.0.7z` バンドルから取得する。
- このバンドルには macOS 用 `.dylib` が **symbolic link** として含まれ、その展開には
  Windows の `SeCreateSymbolicLinkPrivilege` が必要になる。
- **開発者モード無効・非管理者** の環境ではこの権限が無く、`7za` が
  `exit status 2`(「クライアントは要求された特権を保有していません」) で失敗する。
- ダウンロード URL は `app-builder` ネイティブバイナリ内に **ハードコード** されており、
  `electron-builder.yml` の `toolsets` 設定では別バンドルへ切り替えられない
  (`toolsets.winCodeSign: "1.1.0"` を試しても旧 7z を取りに行く)。

### 対処 (自動)
`scripts/prepare-wincodesign-cache.js` が `build:win` / `build:win:exe` の前段
(`npm run prepare:wincache`) で自動実行される。挙動は次のとおり。

1. Windows 以外では何もしない (mac/Linux ビルドに影響なし)。
2. `%LOCALAPPDATA%\electron-builder\Cache\winCodeSign\winCodeSign-2.6.0\` に
   `rcedit-x64.exe` と `windows-10\x64\signtool.exe` が既にあれば何もしない。
3. 無ければ `winCodeSign-2.6.0.7z` をダウンロードし、**`darwin` フォルダを除外**
   (`7za x -xr!darwin`) して展開し、上記キャッシュ位置へ配置する。macOS 用の
   symbolic link を含まないため、通常ユーザー権限でも展開できる。

これにより electron-builder は winCodeSign を「展開済み」とみなし、再ダウンロードを
スキップする。`darwin` は macOS ホスト用ツールなので Windows ビルドでは不要。

> キャッシュ位置は `ELECTRON_BUILDER_CACHE` 環境変数を尊重する。

### 対処 (手動フォールバック)
`prepare:wincache` が (ネットワーク等で) 失敗しても、次のいずれかで直接解決できる。

- **Windows の「開発者モード」を有効化** (設定 → プライバシーとセキュリティ →
  開発者向け)。非管理者でも symbolic link を作成できるようになり、electron-builder
  本来のダウンロード/展開がそのまま成功する。**最も恒久的**。
- **一度だけ管理者権限のシェルで `npm run build:win` を実行**。`SeCreateSymbolicLinkPrivilege`
  が付与され winCodeSign が正常展開・キャッシュされる。以降は非管理者でもキャッシュを
  再利用して成功する。

## 注意
- `winCodeSign-2.6.0` のバージョンが electron-builder 更新で変わった場合は、
  `scripts/prepare-wincodesign-cache.js` の `WIN_CODESIGN_VERSION` を追随させる。
- 署名証明書を設定していない場合でも、上記 rcedit/signtool は exe のリソース編集に
  使われるため winCodeSign バンドル自体は必要になる。
