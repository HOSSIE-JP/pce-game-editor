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
| iconv-lite | 0.6.3 | MIT | `licenses/iconv-lite-MIT.txt` |
| safer-buffer | 2.1.2 | MIT | `licenses/safer-buffer-MIT.txt` |
| @audio/encode-ogg | 1.2.2 | MIT | `licenses/audio-encode-ogg-MIT.txt` |
| wasm-media-encoders (bundled Ogg code) | 0.7.0 | MIT | `licenses/wasm-media-encoders-MIT.txt` |
| @swc/helpers (bundled helpers) | 0.5.23 | Apache-2.0 | `licenses/swc-helpers-Apache-2.0.txt` |
| libogg | 1.3.4 | BSD-style | `licenses/libogg-1.3.4-BSD.txt` |
| libvorbis | 1.3.7 | BSD-style | `licenses/libvorbis-1.3.7-BSD.txt` |
| Misaki Gothic | 2021-05-05 | Misaki Font License | `third_party/misaki-font/LICENSE.txt` |

Electron distributions also include `LICENSE.electron.txt` and
`LICENSES.chromium.html`. Those files contain the Electron notice and the
notices for Chromium, Node.js, FFmpeg, and other projects incorporated into
the Electron runtime. They must remain with the distributed application.

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
firmware. They are not included in PCE Game Editor, its generated game media,
or its HTML exports.
