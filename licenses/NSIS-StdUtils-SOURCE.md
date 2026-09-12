# NSIS / StdUtils sources for PCEGameEditor 0.4.1 portable EXE

Source download location: https://github.com/HOSSIE-JP/pce-game-editor/releases/tag/v0.4.1

The self-extracting Windows EXE uses electron-builder 26.8.1's portable target
with `useZip: true`. NSIS embeds application files directly with `File /r` and
uses its zlib/Deflate decoder. StdUtils passes command-line parameters to the
application. NSIS is 3.0.4.1; the resource bundle is 3.4.1; StdUtils is release
1.14 (DLL file version 1.1.4.0), Unicode x86 even for the x64 application.

## Included source materials

- `StdUtils.2018-10-27.sources.tbz2`: unchanged official source, Visual Studio
  solution/project, NSIS interface headers, and license/attribution files.
- `PCEGameEditor-0.4.1-portable-rebuild-source.tar.gz`: the package metadata and
  configuration needed to rebuild the launcher around the application ZIP,
  plus exact electron-builder 26.8.1 NSIS templates for inspection.
- `NSIS_SOURCE_MANIFEST.json`: official source URLs, hashes, and observed DLL hashes.

StdUtils official release: https://github.com/lordmulder/stdutils/releases/tag/1.14
Author's license clarification: https://nsis.sourceforge.io/StdUtils_plug-in
NSIS license: https://nsis.sourceforge.io/License

PCE Game Editor does not modify StdUtils. The official Unicode DLL SHA-256 is
`b72e9013a6204e9f01076dc38dabbf30870d44dfc66962adbf73619d4331601e`.
It matches the DLL in the electron-builder resources used for this release.

## Building a compatible replacement

Extract the StdUtils source archive and open
`Contrib/StdUtils/StdUtils.sln`. Its project defines
`Release_Unicode|Win32` and contains the NSIS interface headers/import libraries.
Use a compatible Microsoft Visual C++ toolchain and Windows SDK. The included
project is the original historical project; a current toolchain may require
normal project retargeting. Preserve the Unicode x86 NSIS plug-in ABI and exports,
especially `GetAllParameters`. Mark source changes as your own.

## Rebuilding the launcher without the private application repository

The application ZIP on the same release supplies the unencrypted application
object files needed for recombination. Work in a new directory, separate from
an installed app. Extract the rebuild-source archive and work in its
`portable-rebuild` directory. Install Node.js and a tool able to extract 7z files.

1. Extract `PCEGameEditor-0.4.1-win-x64.zip` into `app`; this directory must
   directly contain `PCEGameEditor.exe` and `resources`.
2. Obtain the original NSIS resource bundle from
   https://github.com/electron-userland/electron-builder-binaries/releases/download/nsis-resources-3.4.1/nsis-resources-3.4.1.7z
   and extract it into `nsis-resources`.
3. Replace `nsis-resources/plugins/x86-unicode/StdUtils.dll` with your compatible
   replacement. Other resource files are build inputs; unused plug-ins are not
   automatically embedded in the launcher.
4. In PowerShell in this directory, run:

```powershell
$env:ELECTRON_BUILDER_NSIS_RESOURCES_DIR = (Resolve-Path ./nsis-resources).Path
$env:CSC_IDENTITY_AUTO_DISCOVERY = "false"
npx --yes electron-builder@26.8.1 --prepackaged ./app --win portable --x64 --config ./portable-rebuild.json --publish never
```

The new EXE appears under `rebuilt`. The fixed builder version uses the same
NSIS templates whose source copy is supplied here. The documented resource
override is implemented by its `NSIS_RESOURCES_PATH`. The builder obtains its
standard NSIS compiler and packaging tools separately. No private repository,
private key, original signing certificate, or editor source checkout is required.
The original template copies are retained for inspection and modification; the
command above uses the templates installed by the pinned builder package.

This is a source/recombination route, not a claim of byte-identical reproduction.
A replacement StdUtils DLL has not been compiled in this audit, and the historical
Visual Studio toolchain has not been installed or validated. The supplied original
DLL, source archive, build configuration and license texts were identified and
checked independently of those limitations.

## Licenses and replacement rights

StdUtils is LGPL-2.1-or-later. Its author expressly classifies installers which
use its NSIS interface and redistribute an unchanged DLL as works using the
library, rather than derivatives of it. The complete original clarification is
included as `licenses/StdUtils-LGPL-NOTICE.txt` in the application; the LGPL text
is `licenses/NSIS-LGPL-2.1.txt`.

The MIT terms of this application do not restrict modifying or replacing the
LGPL library, recombining it with the supplied application objects, or reverse
engineering to debug modifications to that library. There is no signature check
that requires an original developer key for the replacement launcher.

StdUtils also incorporates RHash, BLAKE2 and Apache-origin Base64 code. Their
original notices are preserved in `licenses/StdUtils-RHash-LICENSE.txt`,
`StdUtils-BLAKE2-CC0.txt` and `StdUtils-Apache-Base64-NOTICE.txt`.
This product includes software developed by the Apache Group for use in the
Apache HTTP server project (http://www.apache.org/).

The NSIS runtime and standard plug-ins used here are zlib/libpng licensed.
`licenses/NSIS-COPYING.txt` preserves its full license collection. The CPL
exception in that collection concerns the optional LZMA compression module;
this launcher uses zlib and does not use that module. A build tool's license is
not automatically the license of its generated output.

The selected portable configuration does not include WinShell, UAC, nsis7z,
or elevate.exe. Downloads of those unused components collected during auditing
are not release assets and are not needed to rebuild a changed StdUtils library.
