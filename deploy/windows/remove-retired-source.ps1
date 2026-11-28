[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
$workspace = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..\..')).TrimEnd('\')
if ($workspace -ne 'C:\Users\Administrator\Documents\KonTum') {
    throw 'Unexpected workspace; no files were deleted.'
}

$archive = [IO.Path]::GetFullPath((Join-Path $workspace 'kontum_web\storage\retired-source'))
$expected = 'C:\Users\Administrator\Documents\KonTum\kontum_web\storage\retired-source'
if ($archive -ne $expected) { throw 'Unexpected cleanup target.' }
if (-not (Test-Path -LiteralPath $archive)) {
    Write-Output 'The retired source directory has already been removed.'
    return
}
if ((Get-Item -LiteralPath $archive -Force).Attributes -band [IO.FileAttributes]::ReparsePoint) {
    throw 'Cleanup target is a link; refusing recursive deletion.'
}
foreach ($required in @(
    'kontum_web\server.js',
    'kontum_web\.env',
    'kontum_web\.secrets',
    'kontum_web\data',
    'kontum_web\storage\legacy-api',
    'reports\ssl\reload-nginx.ps1'
)) {
    if (-not (Test-Path -LiteralPath (Join-Path $workspace $required))) {
        throw "Missing retained runtime: $required"
    }
}
$response = Invoke-WebRequest -UseBasicParsing -Uri 'http://127.0.0.1:42026/' -TimeoutSec 20
if ($response.StatusCode -ne 200) { throw 'Application health check failed; cleanup cancelled.' }

Write-Output "Deleting only retired source: $archive"
# Use Node for Windows long paths and pnpm symlinks; PowerShell 5 can fail on
# those reparse points. The helper independently validates its exact target.
& node (Join-Path $PSScriptRoot 'remove-retired-source.cjs')
if ($LASTEXITCODE -ne 0) { throw 'Retired source cleanup failed.' }
