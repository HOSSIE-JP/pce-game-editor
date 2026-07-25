param(
  [string]$PlayerZip = (Join-Path $PSScriptRoot '..\dist\pce-web-player.zip')
)

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.IO.Compression.FileSystem

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$playerZipPath = (Resolve-Path -LiteralPath $PlayerZip).Path
$tempRoot = Join-Path $repoRoot '.tmp-pce-web-player-runtime-options'

if (Test-Path -LiteralPath $tempRoot) {
  Remove-Item -LiteralPath $tempRoot -Recurse -Force
}

try {
  New-Item -ItemType Directory -Path $tempRoot | Out-Null
  $extractRoot = Join-Path $tempRoot 'player'
  Expand-Archive -LiteralPath $playerZipPath -DestinationPath $extractRoot -Force
  $indexPath = Join-Path $extractRoot 'index.html'
  $html = [System.IO.File]::ReadAllText($indexPath)

  if ($html -notmatch "window\.EJS_forceLegacyCores = true;") {
    throw 'The player index does not contain the expected EmulatorJS legacy-core setting.'
  }
  if ($html -notmatch "window\.EJS_defaultOptions = \{ vsync: 'disabled' \};") {
    $options = @"
    window.EJS_disableDatabases = true;
    window.EJS_disableLocalStorage = true;
    window.EJS_defaultOptions = { vsync: 'disabled' };
"@
    $html = $html.Replace("    window.EJS_forceLegacyCores = true;", "    window.EJS_forceLegacyCores = true;`r`n$options".TrimEnd())
    [System.IO.File]::WriteAllText($indexPath, $html, [System.Text.UTF8Encoding]::new($false))
  }

  $checkedHtml = [System.IO.File]::ReadAllText($indexPath)
  foreach ($required in @(
    "window.EJS_forceLegacyCores = true;",
    "window.EJS_disableDatabases = true;",
    "window.EJS_disableLocalStorage = true;",
    "window.EJS_defaultOptions = { vsync: 'disabled' };"
  )) {
    if (-not $checkedHtml.Contains($required)) { throw "Missing required player option: $required" }
  }

  Remove-Item -LiteralPath $playerZipPath -Force
  [System.IO.Compression.ZipFile]::CreateFromDirectory($extractRoot, $playerZipPath, [System.IO.Compression.CompressionLevel]::Optimal, $false)
  Write-Output "Updated $playerZipPath"
  Get-FileHash -Algorithm SHA256 -LiteralPath $playerZipPath | Select-Object Algorithm,Hash,Path
}
finally {
  if (Test-Path -LiteralPath $tempRoot) {
    Remove-Item -LiteralPath $tempRoot -Recurse -Force
  }
}
