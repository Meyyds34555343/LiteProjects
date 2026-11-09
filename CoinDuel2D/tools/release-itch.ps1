# Builds CoinDuel2D for itch.io and produces a valid HTML5 zip.
#
# Closes Cocos Creator first. Creator holds files open and can deadlock on
# "Script compilation in progress" if it is running during a CLI build.
#
# Usage:
#   pwsh -File tools/release-itch.ps1

$ErrorActionPreference = "Stop"

$proj = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$exe = "C:\ProgramData\cocos\editors\Creator\3.8.8\CocosCreator.exe"
$outName = "web-mobile-itch-v2"
$buildDir = Join-Path $proj "build\$outName"
$zipPath = Join-Path $proj "..\itch-build\CoinDuel2D-itch-html5.zip"

if (-not (Test-Path $exe)) { throw "Cocos Creator 3.8.8 not found at $exe" }

Write-Host "[1/5] Closing Cocos Creator..."
Get-Process CocosCreator -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
Start-Sleep -Seconds 2

Write-Host "[2/5] Building web-mobile (all scenes)..."
$cfg = Join-Path $PSScriptRoot "itch-build.json"
& $exe --project $proj --build "configPath=$cfg" 2>&1 | Out-String | Write-Verbose

$indexJs = Join-Path $buildDir "index.js"
if (-not (Test-Path $indexJs)) { throw "Build failed: $indexJs not produced." }

Write-Host "[3/5] Installing patched boot page..."
Copy-Item (Join-Path $proj "build-templates\web-mobile\index.ejs") (Join-Path $buildDir "index.html") -Force

Write-Host "[4/5] Packing zip (forward-slash entries)..."
& (Join-Path $PSScriptRoot "make-itch-zip.ps1") -Source $buildDir -Output $zipPath

Write-Host "[5/5] Verifying scene bundle contents..."
$settings = Get-Content (Join-Path $buildDir "src\settings.json") -Raw
foreach ($s in @("main", "levels", "game", "pvp")) {
  if ($settings -notmatch [regex]::Escape("$s.scene")) { Write-Warning "scene '$s' may be missing from the build" }
}

Write-Host ""
Write-Host "Upload this file to itch.io (Project > Edit game > Uploads):"
Write-Host "  $zipPath"
