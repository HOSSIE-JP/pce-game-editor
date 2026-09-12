# Electron / FFmpeg source materials for PCEGameEditor 0.4.1

Download location: https://github.com/HOSSIE-JP/pce-game-editor/releases/tag/v0.4.1

The same release as the Windows application provides the following source archives at no charge.
These archives contain third-party compliance materials, not PCE Game Editor project files.

## Exact version chain

- Electron: v41.3.0, commit `12410f16ba11671c969bdb33303cfe35c1a433f8`.
- Electron DEPS selects Chromium `146.0.7680.188` and Node.js `v24.15.0`.
- Chromium DEPS selects FFmpeg `ae11d2ba5c835b822a61d6a99eeb853ca30d41d8`.
- The Windows x64 Chrome configuration states `CONFIG_GPL=0`, `CONFIG_NONFREE=0`,
  `CONFIG_VERSION3=0`, and `FFMPEG_LICENSE="LGPL version 2.1 or later"`.

## Included archives

| Archive | Content / extraction location in an Electron checkout |
| --- | --- |
| `ffmpeg-ae11d2ba5c835b822a61d6a99eeb853ca30d41d8-source.tar.gz` | FFmpeg source, licenses, generated Chrome/win/x64 configuration, and build scripts; `src/third_party/ffmpeg` |
| `electron-v41.3.0-source.tar.gz` | Electron source, exact DEPS, patch lists, all.gn/release.gn, Windows build instructions; `src/electron` |
| `chromium-146.0.7680.188-build-source.tar.gz` | Chromium build scripts; `src/build` |
| `chromium-146.0.7680.188-opus-source.tar.gz` | Chromium Opus source and build integration; `src/third_party/opus` |
| `chromium-nasm-af5eeeb054bebadfbb79c7bcd100a95e2ad4525f-source.tar.gz` | Fixed NASM source and GN integration; `src/third_party/nasm` |
| `chromium-146.0.7680.188-ffmpeg-build-support.tar.gz` | Chromium root license and DEPS, root GN files, media options, test.gni and stub generator, with original Git blob hashes; its chromium/ contents belong under src/ |

SHA-256 and official download URLs are recorded in `THIRD_PARTY_SOURCE_MANIFEST.json`.
All upstream archives are retained unmodified. Chromium build support files were
read from the exact official Chromium tag and verified against their Git blob hashes.

## Modifications and build configuration

PCE Game Editor does not modify the supplied Electron runtime or ffmpeg.dll.
Electron itself applies the FFmpeg patches listed in `electron/patches/ffmpeg/.patches`.
For this tag the sole patch is `link_with_loader_path.patch`, a macOS install-name change.
It is included in the Electron source archive; apply it through Electron's standard patch hooks.

The distributed Electron release uses `electron/build/args/release.gn`, which imports
`all.gn`: `is_component_ffmpeg=true`, `ffmpeg_branding="Chrome"`,
`proprietary_codecs=true`. Codec branding is separate from GPL/nonfree settings.
The library's generated configuration and configure command are retained in
`chromium/config/Chrome/win/x64/config.h` inside the FFmpeg archive.
Do not substitute `electron/build/args/ffmpeg.gn`; that describes Electron's separate
codec-reduced FFmpeg distribution, not the default library in the application.

## Obtaining the complete build checkout

The exact upstream instructions are included in the Electron archive at
`docs/development/build-instructions-gn.md`, `build-instructions-windows.md`,
and `patches.md`. Use the tag/commit above, not the latest branch.

A Chromium/Electron GN build needs the broader pinned checkout and Windows compiler/SDK
tools. Follow those instructions with depot_tools and gclient, check out Electron at
the recorded commit, then synchronize with its DEPS so all transitive revisions and
standard tools match. The supplied Chromium DEPS also records these dependency revisions.
The source archives above preserve FFmpeg and its directly used Opus source, configuration,
Electron patches and core GN scripts without requiring the private application repository.

For the official Release configuration, generate out/Release using
`electron/build/args/release.gn` with `target_cpu="x64"`. The FFmpeg GN target is
`//third_party/ffmpeg:ffmpeg`. The upstream instructions explain how to generate the
Ninja build and build targets. No new runtime build was performed for this audit.

These downloads are not an offline mirror of every Chromium dependency or of proprietary
Windows development tools, and byte-for-byte reproducibility of Electron's release
binaries has not been verified. They must not be described as such.

## Your LGPL rights

The application is MIT-licensed. Its terms do not restrict modification, compatible
replacement of ffmpeg.dll, or reverse engineering for debugging modifications to the
LGPL-covered library, as permitted by LGPL 2.1 section 6. Keep the license notices when
redistributing it. A compatible modified ffmpeg.dll can be substituted beside the
application executable; its ABI and target architecture must match the runtime.

The original LGPL text is included in the FFmpeg archive as `COPYING.LGPLv2.1` and
in the application as `licenses/FFmpeg-LGPL-2.1.txt`. No warranty is provided.

Official references:

- https://github.com/electron/electron/blob/v41.3.0/DEPS
- https://github.com/chromium/chromium/blob/146.0.7680.188/DEPS
- https://github.com/electron/electron/blob/v41.3.0/build/args/release.gn
- https://github.com/electron/electron/blob/v41.3.0/build/args/all.gn
- https://www.ffmpeg.org/legal.html
- https://www.gnu.org/licenses/old-licenses/lgpl-2.1.html
