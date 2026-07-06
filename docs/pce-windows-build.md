# Windows 版のビルド (exe / zip / installer)

PC Engine Game Editor の Windows 配布物をビルドする手順と、Windows 固有のハマりどころ
(winCodeSign の symbolic link 権限問題) をまとめる。

## コマンドと成果物

| コマンド | 生成物 | 説明 |
| --- | --- | --- |
| `npm run build:win` | `dist/PCEGameEditor-<version>-<arch>.zip` | exe をビルドして zip 化 |
| `npm run build:win:installer` | `dist/PCEGameEditor Setup <version>.exe` (NSIS) | インストーラ exe |

VSCode からは Tasks (`Ctrl+Shift+P` → "Tasks: Run Task") の
「**Windows EXE をビルドして zip 作成**」でも同じ `build:win` を実行できる。
`electron-builder.yml` の `win.target` が `zip` なので、exe ビルドから zip 作成までが
1 コマンドで完結する。

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
`scripts/prepare-wincodesign-cache.js` が `build:win` / `build:win:installer` の前段
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
