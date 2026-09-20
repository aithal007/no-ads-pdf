# Zips extension/ into pocket-pdf-extension.zip, ready to upload to the Edge Add-ons (or Chrome Web Store)
# developer dashboard. Run `npm run build:extension` first if www/ changed since the last zip.
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$src = Join-Path $root 'extension'
$out = Join-Path $root 'pocket-pdf-extension.zip'

if (-not (Test-Path $src)) { throw "extension/ not found. Run 'npm run build:extension' first." }
if (Test-Path $out) { Remove-Item $out }

Compress-Archive -Path (Join-Path $src '*') -DestinationPath $out
Write-Host "Packaged: $out"
