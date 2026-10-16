<#
.SYNOPSIS
  Build ứng dụng MobileGIS Kon Tum (Android) trỏ tới máy chủ triển khai.
.EXAMPLE
  .\build-apk.ps1 -ApiUrl https://webgis.kontum.gov.vn
  .\build-apk.ps1 -ApiUrl http://103.1.2.3 -Aab        # thêm gói .aab để đưa lên Google Play
.NOTES
  Cần Flutter 3.47.5 (xem .fvmrc), Android SDK 36, JDK 17. Ký phát hành: tạo android\key.properties (xem README.md mục 3).
#>
param(
  [Parameter(Mandatory = $true)][string]$ApiUrl,
  [switch]$Aab,
  [switch]$DemoLogin
)
$ErrorActionPreference = 'Stop'
Set-Location $PSScriptRoot
$ApiUrl = $ApiUrl.TrimEnd('/')
$demo = if ($DemoLogin) { 'true' } else { 'false' }
$defines = @("--dart-define=API_BASE_URL=$ApiUrl", "--dart-define=DEMO_LOGIN=$demo")

flutter --version
flutter pub get
if ($LASTEXITCODE -ne 0) { throw 'flutter pub get thất bại' }
flutter build apk --release @defines
if ($LASTEXITCODE -ne 0) { throw 'Build APK thất bại' }
if ($Aab) { flutter build appbundle --release @defines; if ($LASTEXITCODE -ne 0) { throw 'Build AAB thất bại' } }

New-Item -ItemType Directory -Force -Path release | Out-Null
$ver = (Select-String -Path pubspec.yaml -Pattern '^version:\s*([0-9.]+)').Matches[0].Groups[1].Value
Copy-Item build\app\outputs\flutter-apk\app-release.apk "release\WebGISKonTum-$ver.apk" -Force
if ($Aab) { Copy-Item build\app\outputs\bundle\release\app-release.aab "release\WebGISKonTum-$ver.aab" -Force }
Write-Host ''
Write-Host "Xong: release\WebGISKonTum-$ver.apk (máy chủ: $ApiUrl)" -ForegroundColor Green
if (-not (Test-Path android\key.properties)) { Write-Host 'Lưu ý: chưa có android\key.properties – APK đang ký bằng khoá debug (chỉ dùng thử).' -ForegroundColor Yellow }
