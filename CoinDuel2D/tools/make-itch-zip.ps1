# Packs a Cocos web-mobile build into an itch.io-ready HTML5 zip.
#
# IMPORTANT: zip entry names MUST use forward slashes ("assets/main/x.json").
# Windows tooling (Compress-Archive, and .NET's ZipFile.CreateFromDirectory on
# older runtimes) writes "assets\main\x.json" instead. Those are not folders —
# unzippers create one literal file whose name contains backslashes, so every
# asset 404s and itch.io's HTML5 pipeline treats the upload as invalid.
#
# This script writes entries itself so the separators are always '/'.
#
# Usage:
#   pwsh -File tools/make-itch-zip.ps1 [-Source <dir>] [-Output <zip>]

param(
  [string]$Source = (Join-Path $PSScriptRoot "..\build\web-mobile-itch-v2"),
  [string]$Output = (Join-Path $PSScriptRoot "..\..\itch-build\CoinDuel2D-itch-html5.zip")
)

$ErrorActionPreference = "Stop"
Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem

$Source = (Resolve-Path $Source).Path
if (-not (Test-Path (Join-Path $Source "index.html"))) {
  throw "index.html missing at the root of $Source - itch.io requires it there."
}

$outDir = Split-Path -Parent $Output
if (-not (Test-Path $outDir)) { New-Item -ItemType Directory -Force -Path $outDir | Out-Null }
if (Test-Path $Output) { Remove-Item $Output -Force }

$srcLen = $Source.Length + 1
$count = 0

$zip = [System.IO.Compression.ZipFile]::Open($Output, [System.IO.Compression.ZipArchiveMode]::Create)
try {
  Get-ChildItem -Path $Source -Recurse -File | ForEach-Object {
    $rel = $_.FullName.Substring($srcLen) -replace '\\', '/'
    $entry = $zip.CreateEntry($rel, [System.IO.Compression.CompressionLevel]::Optimal)
    $entry.LastWriteTime = $_.LastWriteTime
    $sink = $entry.Open()
    try {
      $src = [System.IO.File]::OpenRead($_.FullName)
      try { $src.CopyTo($sink) } finally { $src.Dispose() }
    } finally { $sink.Dispose() }
    $count++
  }
} finally {
  $zip.Dispose()
}

# Verify: forward slashes only, index.html at root.
$check = [System.IO.Compression.ZipFile]::OpenRead($Output)
try {
  $bad = @($check.Entries | Where-Object { $_.FullName -match '\\' })
  $hasIndex = @($check.Entries | Where-Object { $_.FullName -eq 'index.html' }).Count -eq 1
  $bytes = (Get-Item $Output).Length
} finally {
  $check.Dispose()
}

if ($bad.Count -gt 0) { throw "$($bad.Count) zip entries still contain backslashes." }
if (-not $hasIndex) { throw "index.html is not at the zip root." }

Write-Host ("OK  {0} entries, {1:N2} MB" -f $count, ($bytes / 1MB))
Write-Host ("    {0}" -f $Output)
