param(
  [string]$PlayerZip = (Join-Path $PSScriptRoot '..\dist\pce-web-player.zip'),
  [string]$OutputZip = (Join-Path $PSScriptRoot '..\dist\pce-web-player-source.zip')
)

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.IO.Compression.FileSystem

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$playerZipPath = (Resolve-Path -LiteralPath $PlayerZip).Path
$outputZipPath = [System.IO.Path]::GetFullPath($OutputZip)

if (-not (Test-Path -LiteralPath $playerZipPath -PathType Leaf)) {
  throw "Player ZIP was not found: $playerZipPath"
}
$tempRoot = Join-Path $repoRoot '.tmp-pce-web-player-source-build'
if (Test-Path -LiteralPath $tempRoot) {
  Remove-Item -LiteralPath $tempRoot -Recurse -Force
}
New-Item -ItemType Directory -Path $tempRoot | Out-Null

try {
  $packageRoot = Join-Path $tempRoot 'pce-web-player-source'
  New-Item -ItemType Directory -Path $packageRoot | Out-Null
  $playerSourceRoot = Join-Path $packageRoot 'player'
  $thirdPartyRoot = Join-Path $packageRoot 'third-party'
  New-Item -ItemType Directory -Path $playerSourceRoot | Out-Null
  New-Item -ItemType Directory -Path $thirdPartyRoot | Out-Null

  $playerArchive = [System.IO.Compression.ZipFile]::OpenRead($playerZipPath)
  try {
    foreach ($entryName in @('index.html', 'source-offer.html', 'LICENSES/THIRD-PARTY-NOTICES.txt')) {
      $entry = $playerArchive.GetEntry($entryName)
      if ($null -eq $entry) {
        throw "Player ZIP is missing required entry: $entryName"
      }
      $destination = Join-Path $playerSourceRoot ($entryName -replace '^LICENSES/', 'LICENSES\\')
      $destinationParent = Split-Path -Parent $destination
      New-Item -ItemType Directory -Path $destinationParent -Force | Out-Null
      [System.IO.Compression.ZipFileExtensions]::ExtractToFile($entry, $destination, $true)
    }
    $romEntry = $playerArchive.GetEntry('game.pce')
    if ($null -eq $romEntry) { throw 'Player ZIP is missing game.pce.' }
    $playerRomHash = [System.Security.Cryptography.SHA256]::Create()
    try {
      $romStream = $romEntry.Open()
      try { $playerRomSha256 = [Convert]::ToHexString($playerRomHash.ComputeHash($romStream)).ToLowerInvariant() }
      finally { $romStream.Dispose() }
    }
    finally { $playerRomHash.Dispose() }
  }
  finally {
    $playerArchive.Dispose()
  }

  $downloads = @(
    [pscustomobject]@{
      Name = 'EmulatorJS-v4.2.3'
      Uri = 'https://github.com/EmulatorJS/EmulatorJS/archive/refs/tags/v4.2.3.zip'
      ExpectedDirectory = 'EmulatorJS-4.2.3'
    },
    [pscustomobject]@{
      Name = 'beetle-pce-libretro-9a301c0773c53702a882bbaa42ee9cbc6d523787'
      Uri = 'https://github.com/EmulatorJS/beetle-pce-libretro/archive/9a301c0773c53702a882bbaa42ee9cbc6d523787.zip'
      ExpectedDirectory = 'beetle-pce-libretro-9a301c0773c53702a882bbaa42ee9cbc6d523787'
    }
  )
  foreach ($download in $downloads) {
    $downloadZip = Join-Path $tempRoot ($download.Name + '.zip')
    Invoke-WebRequest -Uri $download.Uri -OutFile $downloadZip
    $extractRoot = Join-Path $tempRoot ($download.Name + '-extract')
    Expand-Archive -LiteralPath $downloadZip -DestinationPath $extractRoot -Force
    $sourceDirectory = Join-Path $extractRoot $download.ExpectedDirectory
    if (-not (Test-Path -LiteralPath $sourceDirectory -PathType Container)) {
      throw "Downloaded source did not contain expected directory: $($download.ExpectedDirectory)"
    }
    Move-Item -LiteralPath $sourceDirectory -Destination (Join-Path $thirdPartyRoot $download.Name)
  }

  $sourcePackageManifest = [ordered]@{
    format = 'pce-web-player-source/1'
    playerZip = 'pce-web-player.zip'
    playerZipSha256 = (Get-FileHash -Algorithm SHA256 -LiteralPath $playerZipPath).Hash.ToLowerInvariant()
    gameRom = 'game.pce (identifier only; game source is not included)'
    gameRomSha256 = $playerRomSha256
    emulatorJS = [ordered]@{
      version = '4.2.3'
      gitCommit = 'e150dc0491ae747028919fb82d6598954976ede6'
      sourceDirectory = 'third-party/EmulatorJS-v4.2.3'
      sourceUrl = 'https://github.com/EmulatorJS/EmulatorJS/tree/v4.2.3'
    }
    beetlePce = [ordered]@{
      package = '@emulatorjs/core-mednafen_pce@4.2.3'
      packageIntegrity = 'sha512-PwnQAKKxWT8m8dUscH4VX8jcClvgxgR/NkE6FxNE8qiRDyBH3Jze7+tF9+UdWLoJRBwssR5knd7o/Es9xIlU6A=='
      sourceCommit = '9a301c0773c53702a882bbaa42ee9cbc6d523787'
      sourceDirectory = 'third-party/beetle-pce-libretro-9a301c0773c53702a882bbaa42ee9cbc6d523787'
      sourceUrl = 'https://github.com/EmulatorJS/beetle-pce-libretro/tree/9a301c0773c53702a882bbaa42ee9cbc6d523787'
    }
  }
  $manifestJson = $sourcePackageManifest | ConvertTo-Json -Depth 8
  [System.IO.File]::WriteAllText((Join-Path $packageRoot 'SOURCE-MANIFEST.json'), $manifestJson + [Environment]::NewLine, [System.Text.UTF8Encoding]::new($false))

  $readme = @"
# pce-web-player corresponding source package

This archive accompanies ``pce-web-player.zip``.  It includes the exact player
configuration and the source snapshots for the bundled GPL components.

## Distributed player identification

- Player ZIP SHA-256: $($sourcePackageManifest.playerZipSha256)
- ``game.pce`` SHA-256: $playerRomSha256

## GPL-covered components

- EmulatorJS v4.2.3 (unmodified), GPL-3.0-or-later
  - Source: ``third-party/EmulatorJS-v4.2.3``
  - Upstream tag/commit: ``v4.2.3`` / ``e150dc0491ae747028919fb82d6598954976ede6``
- Beetle PCE (``mednafen_pce``; not Beetle PCE Fast), distributed as
  ``@emulatorjs/core-mednafen_pce@4.2.3`` (unmodified), GPL-2.0
  - Source: ``third-party/beetle-pce-libretro-9a301c0773c53702a882bbaa42ee9cbc6d523787``
  - Upstream source snapshot: ``9a301c0773c53702a882bbaa42ee9cbc6d523787``
  - NPM package integrity: ``sha512-PwnQAKKxWT8m8dUscH4VX8jcClvgxgR/NkE6FxNE8qiRDyBH3Jze7+tF9+UdWLoJRBwssR5knd7o/Es9xIlU6A==``

``SOURCE-MANIFEST.json`` is the machine-readable version of these identifiers.
The player ZIP's ``LICENSES/`` directory contains the license texts and notices.

## Other included source

- ``player/``: the player-specific ``index.html``, source offer, and notices.

The HuCard ROM is game content loaded by the emulator.  Its source code is not
included in this archive.  PCE Game Editor is also not included: neither is a
GPL-covered component of this browser player package.

No PC Engine System Card, IPL, BIOS, or other firmware is included.
"@
  [System.IO.File]::WriteAllText((Join-Path $packageRoot 'README.md'), $readme.Trim() + [Environment]::NewLine, [System.Text.UTF8Encoding]::new($false))

  if (Test-Path -LiteralPath $outputZipPath) {
    Remove-Item -LiteralPath $outputZipPath -Force
  }
  [System.IO.Compression.ZipFile]::CreateFromDirectory($packageRoot, $outputZipPath, [System.IO.Compression.CompressionLevel]::Optimal, $false)
  Write-Output "Created $outputZipPath"
  Get-Item -LiteralPath $outputZipPath | Select-Object FullName,Length,LastWriteTime
}
finally {
  if (Test-Path -LiteralPath $tempRoot) {
    Remove-Item -LiteralPath $tempRoot -Recurse -Force
  }
}
