'use strict';

// Windows で electron-builder が使う winCodeSign バンドル(rcedit / signtool)を、
// darwin の symbolic link を除外してキャッシュへ事前展開するヘルパー。
//
// 背景:
//   electron-builder は exe へアイコン/バージョン情報を書き込む rcedit と、
//   署名用の signtool.exe を winCodeSign-2.6.0.7z から取得する。このバンドルには
//   macOS 用 .dylib が symbolic link として含まれ、その展開には Windows の
//   SeCreateSymbolicLinkPrivilege が必要になる。開発者モード無効・非管理者では
//   7za が exit status 2 (「クライアントは要求された特権を保有していません」) で
//   失敗し、Windows ビルドが通らない。ダウンロード URL は app-builder バイナリに
//   ハードコードされており electron-builder.yml の toolsets 設定では回避できない。
//   そこで darwin を除いた Windows 用ツールだけを正規のキャッシュ位置へ事前配置し、
//   electron-builder 側の再ダウンロード自体をスキップさせる。
//   詳細は docs/pce-windows-build.md を参照。

const fs = require('fs');
const os = require('os');
const path = require('path');
const https = require('https');
const { spawnSync } = require('child_process');

const WIN_CODESIGN_VERSION = '2.6.0';
const ARCHIVE_NAME = `winCodeSign-${WIN_CODESIGN_VERSION}.7z`;
const DOWNLOAD_URL =
  `https://github.com/electron-userland/electron-builder-binaries/releases/download/` +
  `winCodeSign-${WIN_CODESIGN_VERSION}/${ARCHIVE_NAME}`;

function cacheRoot() {
  if (process.env.ELECTRON_BUILDER_CACHE) {
    return process.env.ELECTRON_BUILDER_CACHE;
  }
  const localAppData = process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local');
  return path.join(localAppData, 'electron-builder', 'Cache');
}

function resolve7za() {
  try {
    return require('7zip-bin').path7za;
  } catch (e) {
    return path.join(__dirname, '..', 'node_modules', '7zip-bin', 'win', process.arch, '7za.exe');
  }
}

function downloadTo(url, dest, redirects = 0) {
  return new Promise((resolve, reject) => {
    if (redirects > 5) {
      reject(new Error('too many redirects'));
      return;
    }
    const req = https.get(url, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume();
        downloadTo(res.headers.location, dest, redirects + 1).then(resolve, reject);
        return;
      }
      if (res.statusCode !== 200) {
        res.resume();
        reject(new Error(`download failed: HTTP ${res.statusCode}`));
        return;
      }
      const out = fs.createWriteStream(dest);
      res.pipe(out);
      out.on('finish', () => out.close(() => resolve()));
      out.on('error', reject);
    });
    req.on('error', reject);
  });
}

async function main() {
  if (process.platform !== 'win32') {
    // Windows 専用の回避策。他 OS では何もしない。
    return;
  }

  const targetDir = path.join(cacheRoot(), 'winCodeSign', `winCodeSign-${WIN_CODESIGN_VERSION}`);
  const rcedit = path.join(targetDir, 'rcedit-x64.exe');
  const signtool = path.join(targetDir, 'windows-10', 'x64', 'signtool.exe');

  if (fs.existsSync(rcedit) && fs.existsSync(signtool)) {
    console.log(`[wincache] winCodeSign cache OK: ${targetDir}`);
    return;
  }

  console.log('[wincache] winCodeSign cache が見つからないため、darwin を除外して事前展開します。');
  console.log('[wincache]   (symbolic link 権限が無い Windows 環境向けの回避策)');

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wincodesign-'));
  const archivePath = path.join(tmpDir, ARCHIVE_NAME);
  const extractDir = path.join(tmpDir, 'extract');

  try {
    console.log(`[wincache] downloading ${DOWNLOAD_URL}`);
    await downloadTo(DOWNLOAD_URL, archivePath);

    const sevenZip = resolve7za();
    // -xr!darwin : darwin フォルダ(macOS .dylib symlink)を除外。Windows ビルドには不要。
    const result = spawnSync(
      sevenZip,
      ['x', '-bd', '-y', '-xr!darwin', `-o${extractDir}`, archivePath],
      { stdio: 'inherit', shell: false },
    );
    if (result.status !== 0) {
      throw new Error(`7za extraction failed with exit code ${result.status}`);
    }

    // 正規のキャッシュ位置へ配置(既存があれば作り直す)。
    fs.mkdirSync(path.dirname(targetDir), { recursive: true });
    fs.rmSync(targetDir, { recursive: true, force: true });
    fs.cpSync(extractDir, targetDir, { recursive: true });

    if (!fs.existsSync(rcedit)) {
      throw new Error(`rcedit-x64.exe not found after extraction: ${rcedit}`);
    }
    console.log(`[wincache] placed winCodeSign cache: ${targetDir}`);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

main().catch((err) => {
  console.error('[wincache] winCodeSign キャッシュの事前展開に失敗しました。');
  console.error(`[wincache]   ${err.message}`);
  console.error('[wincache] 回避策: Windows の「開発者モード」を有効化するか、');
  console.error('[wincache]   一度だけ管理者権限のシェルで build:win を実行してください。');
  // ビルド自体は続行させる(電子ビルダーが自前ダウンロードを試みる)。開発者モード有効/
  // 管理者など symlink 権限がある環境ではこの回避策が無くてもビルドできるため、
  // ここで exit code を立てない。権限が無い環境では electron-builder 側も同じ
  // symbolic link エラーで失敗する点に注意。
  process.exitCode = 0;
});
