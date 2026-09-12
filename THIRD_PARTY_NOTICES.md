# PCE Game Editor Third-Party Notices

This notice covers third-party software redistributed with the PCE Game Editor
desktop application. PCE Game Editor itself is distributed under the MIT
License; see `LICENSE`. The licenses below continue to apply independently to
their respective components.

## Components included in the desktop application

| Component | Version | License | Included notice |
| --- | --- | --- | --- |
| Electron | 41.3.0 | MIT | `licenses/Electron-MIT.txt` |
| @electron/asar | 3.4.1 | MIT | `licenses/electron-asar-MIT.txt` |
| balanced-match | 1.0.2 | MIT | `licenses/balanced-match-MIT.txt` |
| brace-expansion | 1.1.14 | MIT | `licenses/brace-expansion-MIT.txt` |
| minimatch | 3.1.5 | ISC | `licenses/minimatch-ISC.txt` |
| commander | 5.1.0 | MIT | `licenses/commander-MIT.txt` |
| concat-map | 0.0.1 | MIT | `licenses/concat-map-MIT.txt` |
| fs.realpath | 1.0.0 | ISC | `licenses/fs.realpath-ISC.txt` |
| glob | 7.2.3 | ISC | `licenses/glob-ISC.txt` |
| inflight | 1.0.6 | ISC | `licenses/inflight-ISC.txt` |
| inherits | 2.0.4 | ISC | `licenses/inherits-ISC.txt` |
| once | 1.4.0 | ISC | `licenses/once-ISC.txt` |
| path-is-absolute | 1.0.1 | MIT | `licenses/path-is-absolute-MIT.txt` |
| wrappy | 1.0.2 | ISC | `licenses/wrappy-ISC.txt` |
| iconv-lite | 0.6.3 | MIT | `licenses/iconv-lite-MIT.txt` |
| safer-buffer | 2.1.2 | MIT | `licenses/safer-buffer-MIT.txt` |
| @audio/encode-ogg | 1.2.2 | MIT | `licenses/audio-encode-ogg-MIT.txt` |
| wasm-media-encoders (bundled Ogg code) | 0.7.0 | MIT | `licenses/wasm-media-encoders-MIT.txt` |
| @swc/helpers (bundled helpers) | 0.5.23 | Apache-2.0 | `licenses/swc-helpers-Apache-2.0.txt` |
| libogg | 1.3.4 | BSD-style | `licenses/libogg-1.3.4-BSD.txt` |
| libvorbis | 1.3.7 | BSD-style | `licenses/libvorbis-1.3.7-BSD.txt` |
| Misaki Gothic | 2021-05-05 | Misaki Font License | `third_party/misaki-font/LICENSE.txt` |
| JF Dot Shinonome Mincho 12 | 1.00.20150527 | Public Domain declaration | `licenses/JF-Dot-ShinonomeMin12-Public-Domain.txt` |

Electron distributions also include `LICENSE.electron.txt` and
`LICENSES.chromium.html`. Those files contain the Electron notice and the
notices for Chromium, Node.js, FFmpeg, and other projects incorporated into
the Electron runtime. They must remain with the distributed application.

The bundled Windows FFmpeg library is LGPL-2.1-or-later. Its complete FFmpeg
source archive at the exact Chromium revision, Electron patches, build
configuration and supporting source materials are supplied beside the binary at
https://github.com/HOSSIE-JP/pce-game-editor/releases/tag/v0.4.1 .
See `licenses/Electron-FFmpeg-SOURCE.md` for the source files, version chain,
rebuild instructions, replacement rights and verification limits. The original
LGPL text is retained in `licenses/FFmpeg-LGPL-2.1.txt`. The editor license does
not restrict compatible library replacement or reverse engineering for debugging
modifications to the LGPL-covered library.

The additional MIT/ISC packages listed above are runtime dependencies of
`@electron/asar`. `licenses/runtime-transitive-sources.json` records the exact
installed source paths, versions and SHA-256 hashes of the unmodified license
copies. The original notices must also remain within the packaged npm dependencies.
The duplicate balanced-match, brace-expansion and minimatch installations under
`glob` use the same versions and license texts.

JF Dot Shinonome Mincho 12 is included in the CD VN template. Its embedded
Public Domain declaration expressly permits modification, conversion, embedding
and redistribution without warranty. The original bitmap font is by The Electronic
Font Open Laboratory; the TrueType conversion is by 自家製フォント工房.
The exact font SHA-256 is
`75ff065a49fdd352eecffc140a88e728c81fc1578ddc31957c3df54dabe0301d`.
The template keeps an additional copy of the embedded license and a provenance
README beside the font under `template/template_pce_vn_cd/assets/fonts/`.

Misaki Gothic is embedded as the recommended 8x8 Japanese bitmap font for the
PCE VN GB Studio exporter. Copyright (C) 2002-2021 Num Kadoma. The original
license grants unlimited permission to use, copy, and distribute the fonts,
with or without modification, commercially or noncommercially, without
warranty. The unmodified license and version history are retained at the path
shown above; generated GB Studio projects also receive a copy.

`@audio/encode-ogg` contains the Ogg-only WebAssembly bridge used by the Godot
package exporter. It incorporates the listed wasm-media-encoders and SWC helper
code plus libogg/libvorbis. The transitive wasm-media-encoders npm package also
ships an unused MP3 encoder, so that package is excluded from desktop builds.

`electron-builder` 26.8.1 (MIT) is used only to create application packages.
It is not an application runtime dependency. Its license is retained in
`licenses/electron-builder-MIT.txt` for source/build distributions.

## Windows self-extracting EXE

The Windows portable EXE also contains the following launcher components.
They are separate from the unpacked application's runtime dependencies.

| Component | Version | License | Included notice |
| --- | --- | --- | --- |
| NSIS runtime, zlib decoder and standard plug-ins | 3.0.4.1 | zlib/libpng | `licenses/NSIS-COPYING.txt` |
| StdUtils Unicode plug-in | 1.14 (DLL 1.1.4.0) | LGPL-2.1-or-later | `licenses/StdUtils-LGPL-NOTICE.txt`, `licenses/NSIS-LGPL-2.1.txt` |
| RHash inside StdUtils | bundled source in 1.14 | RHash permissive license | `licenses/StdUtils-RHash-LICENSE.txt` |
| BLAKE2 inside StdUtils | bundled source in 1.14 | CC0-1.0 | `licenses/StdUtils-BLAKE2-CC0.txt` |
| Apache-origin Base64 inside StdUtils | copyright 1995-1999 | original Apache terms | `licenses/StdUtils-Apache-Base64-NOTICE.txt` |

StdUtils is Copyright (C) 2004-2018 LoRd_MuldeR. RHash is by Aleksey Kravchenko;
the BLAKE2 implementation is by Samuel Neves. StdUtils also acknowledges
Robert Strong's InvokeShellVerb work and the NSIS contributors.

This product includes software developed by the Apache Group for use in the
Apache HTTP server project (http://www.apache.org/).

The exact StdUtils source and the portable launcher build/recombination materials
are provided with the release at
https://github.com/HOSSIE-JP/pce-game-editor/releases/tag/v0.4.1 .
See `licenses/NSIS-StdUtils-SOURCE.md`. You may replace the LGPL library and
recombine it with the application, and reverse engineer to debug changes to that
library. The author's original NSIS interface clarification is retained in the
included notice.

The portable target uses direct NSIS file embedding (`useZip: true`) and
zlib compression. WinShell, UAC, nsis7z and elevate.exe are not included.
The optional NSIS LZMA module has a CPL linking exception in the original
COPYING file, but that module is not used by this launcher.

## Components acquired after installation

The following components are not included in the PCE Game Editor repository or
desktop application package:

- llvm-mos-sdk: downloaded or selected by the user in SetUp. The SDK is
  primarily Apache-2.0 WITH LLVM-exception and also contains files under other
  licenses identified by the SDK distribution.
- EmulatorJS: downloaded or selected by the user in SetUp; GPL-3.0.
- mednafen_pce / Beetle PCE core: delivered with the selected EmulatorJS
  runtime; GPL-2.0-only.
- Windows MinGW runtime DLLs used by `pce-mkcd.exe`: not distributed by this
  application. When needed, the build locates a complete compatible set in the
  user's MinGW, MSYS2, or Git for Windows installation and copies it beside
  `pce-mkcd.exe`.
- External emulators: optional user-selected applications and not distributed
  by PCE Game Editor.

Downloading a component does not remove its license obligations. In particular,
an itch.io HTML5 ZIP exported by PCE Game Editor contains EmulatorJS and the
mednafen_pce core. The publisher must provide the exact corresponding source
and preserve the included GPL notices. The generated ZIP contains a specific
`SOURCE.md` checklist, the EmulatorJS GPL-3.0 text, and the mednafen_pce
GPL-2.0 text.

## User-provided firmware

PCE-CD IPL data and the Japanese Super System Card 3.0 ROM are user-provided
firmware. Neither is included in the PCE Game Editor application package.
System Card ROM files are not copied into generated games or HTML exports.

CD builds pass the selected IPL to `pce-mkcd`, which embeds its first 2048 bytes
in ISO sector 0. The current HTML export supports HuCARD only and rejects
CD projects. Ownership of the source disc does not itself grant redistribution
rights. Publishers of CD media must establish permission for the IPL and imported assets
separately from the editor license. See the upstream build documentation:
https://llvm-mos.org/wiki/PCE_target#Building_an_ISO
