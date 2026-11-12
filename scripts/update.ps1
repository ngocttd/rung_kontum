# Cập nhật WebGIS Kon Tum trên VPS bằng git (chạy PowerShell quyền Administrator):
#   cd C:\webgis-kontum
#   powershell -ExecutionPolicy Bypass -File .\scripts\update.ps1                      # cập nhật mã nguồn
#   powershell -ExecutionPolicy Bypass -File .\scripts\update.ps1 -DataTar D:\goi\rung_kontum_var_data_update_20261111.tar
#                                                                                       # kèm bung gói dữ liệu cập nhật
# Lần đầu (thư mục đang là bản bung từ zip, chưa có .git) script tự gắn git vào thư mục, không xoá data\, storage\, .env.
# Các bước: sao lưu (backup.ps1 nếu có) → dừng dịch vụ → lấy mã mới → bung dữ liệu (nếu có) → npm ci → migration
# → pip (khi requirements.txt đổi) → chuỗi lớp phủ Dynamic World (nếu chưa có) → chạy lệnh bổ sung (nếu có) → khởi động → kiểm tra trang chủ.
param(
  [string]$App = (Split-Path -Parent $PSScriptRoot),
  [string]$Repo = 'https://github.com/ngocttd/rung_kontum.git',
  [string]$Branch = 'main',
  [string]$Service = 'WebGISKonTum',
  [string]$DataTar = '',
  [switch]$SkipBackup,
  [switch]$Landcover,   # tính lại chuỗi lớp phủ Dynamic World (tự chạy khi VPS chưa có data\web\landcover-series.json)
  [switch]$AutoGeoref   # chạy lại tự định vị ảnh bản đồ toàn tỉnh (cần khi nâng cấp lên bản 11/11/2026)
)
$ErrorActionPreference = 'Stop'
Set-Location $App
$log = Join-Path $App ("storage\update-{0}.log" -f (Get-Date -Format 'yyyyMMddHHmm'))
New-Item -ItemType Directory -Force (Join-Path $App 'storage') | Out-Null
Start-Transcript -Path $log -Append | Out-Null
function Step($m) { Write-Host "`n=== $m" -ForegroundColor Cyan }
function Run($exe, [string[]]$a) { & $exe @a; if ($LASTEXITCODE -ne 0) { throw "$exe $($a -join ' ') lỗi (mã $LASTEXITCODE)" } }
$started = $false
try {
  if (-not (Get-Command git -ErrorAction SilentlyContinue)) { throw 'Chưa cài git: winget install --id Git.Git -e (rồi mở lại PowerShell)' }
  if (-not (Test-Path (Join-Path $App 'server.js'))) { throw "Không thấy server.js trong $App" }

  if (-not $SkipBackup -and (Test-Path (Join-Path $App 'backup.ps1'))) { Step 'Sao lưu CSDL và storage (backup.ps1)'; & (Join-Path $App 'backup.ps1') }
  elseif (-not $SkipBackup) { Write-Warning 'Không có backup.ps1 (mục 13.2 tài liệu triển khai) – bỏ qua sao lưu.' }

  $reqBefore = if (Test-Path requirements.txt) { (Get-FileHash requirements.txt).Hash } else { '' }

  Step "Dừng dịch vụ $Service"
  nssm stop $Service | Out-Null

  Step 'Lấy mã nguồn mới từ git'
  if (-not (Test-Path (Join-Path $App '.git'))) {
    Run git @('init', '-b', $Branch)
    Run git @('remote', 'add', 'origin', $Repo)
    Run git @('fetch', 'origin', $Branch)
    # chỉ ghi đè tệp có trên git; .env, .secrets\, data\, storage\, .venv\, node_modules\ giữ nguyên
    Run git @('reset', '--hard', "origin/$Branch")
  } else {
    $dirty = git status --porcelain --untracked-files=no
    if ($dirty) { Write-Warning "Có tệp mã nguồn bị sửa trực tiếp trên máy chủ (sẽ bị thay bằng bản trên git):`n$dirty" }
    Run git @('fetch', 'origin', $Branch)
    Run git @('reset', '--hard', "origin/$Branch")
  }
  git log -1 --format='Phiên bản: %h %ad %s' --date=format:'%d/%m/%Y %H:%M'

  if ($DataTar) {
    Step "Bung gói dữ liệu $DataTar"
    if (-not (Test-Path $DataTar)) { throw "Không thấy $DataTar" }
    Run tar @('-xf', $DataTar, '-C', $App)
  }

  Step 'Cài thư viện Node.js (npm ci)'
  Run npm @('ci', '--omit=dev', '--no-audit', '--no-fund')

  Step 'Áp migration CSDL (npm run db:setup)'
  Run npm @('run', 'db:setup')

  $py = Join-Path $App '.venv\Scripts\python.exe'
  if ((Test-Path $py) -and (Test-Path requirements.txt) -and ((Get-FileHash requirements.txt).Hash -ne $reqBefore)) {
    Step 'requirements.txt thay đổi – cài thư viện Python'
    Run $py @('-m', 'pip', 'install', '-r', 'requirements.txt')
  }

  # Chuỗi lớp phủ hằng năm (Google Dynamic World) – dữ liệu nằm trong data\ (không theo git): dựng khi chưa có hoặc khi chỉ định -Landcover.
  # Có gói dữ liệu (data\collected\dynamic-world) thì chỉ tính lại (vài phút); chưa có thì tải từ GEE (.secrets\gee-key.json, ~20–30 phút).
  if ($Landcover -or -not (Test-Path (Join-Path $App 'data\web\landcover-series.json'))) {
    Step 'Chuỗi lớp phủ hằng năm (Dynamic World)'
    $pyx = if (Test-Path $py) { $py } else { 'python' }
    try {
      if (-not (Test-Path (Join-Path $App 'data\collected\dynamic-world\manifest.json'))) { Run $pyx @('-X', 'utf8', 'scripts\collect_dynamic_world.py') }
      Run $pyx @('-X', 'utf8', 'scripts\landcover_series.py', 'build')
      Run node @('scripts	o_webp.cjs')
    } catch { Write-Warning "Chưa dựng được chuỗi lớp phủ: $($_.Exception.Message). Sau khi khởi động có thể bấm Quản trị › Tài nguyên rừng › Chuỗi lớp phủ hằng năm › Cập nhật ngay." }
  }

  if ($AutoGeoref) { Step 'Tự định vị ảnh bản đồ toàn tỉnh (data\Data_thuc_te)'; Run node @('scripts\autogeoref_real_maps.cjs') }

  Step "Khởi động dịch vụ $Service"
  nssm start $Service | Out-Null
  $started = $true

  $port = 3000
  $envFile = Join-Path $App '.env'
  if (Test-Path $envFile) { $m = Select-String -Path $envFile -Pattern '^\s*PORT\s*=\s*(\d+)' | Select-Object -First 1; if ($m) { $port = [int]$m.Matches[0].Groups[1].Value } }
  Step "Kiểm tra http://localhost:$port"
  $ok = $false
  for ($i = 0; $i -lt 30 -and -not $ok; $i++) {
    Start-Sleep -Seconds 3
    try { $r = Invoke-WebRequest "http://localhost:$port/" -UseBasicParsing -TimeoutSec 10; $ok = $r.StatusCode -eq 200 } catch { }
  }
  if (-not $ok) { throw "Dịch vụ chưa trả lời sau 90 giây – xem log NSSM (mục 10) và $log" }
  Write-Host "`nCẬP NHẬT XONG. Nhật ký: $log" -ForegroundColor Green
} catch {
  Write-Host "`nLỖI: $($_.Exception.Message)" -ForegroundColor Red
  if (-not $started) { Write-Host "Khởi động lại dịch vụ với mã hiện có..."; nssm start $Service | Out-Null }
  Write-Host "Khôi phục mã trước đó: git reflog → git reset --hard HEAD@{1}; CSDL: dùng bản sao lưu mới nhất (mục 13.3). Nhật ký: $log"
  exit 1
} finally { Stop-Transcript | Out-Null }
