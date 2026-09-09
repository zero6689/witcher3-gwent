# ============================================================
# 一键安装 Android 编译工具链（全部装在项目内 .tools/，不需要管理员）
#   - Temurin JDK 17
#   - Android command-line tools + platform-tools + platforms;android-34 + build-tools;34.0.0
# 用法（普通 PowerShell 窗口）：
#   powershell -ExecutionPolicy Bypass -File scripts\setup-android.ps1
# 装完后用 scripts\build-apk.ps1 编译 APK
# ============================================================
param(
  [string]$Tools = (Join-Path (Split-Path -Parent $PSScriptRoot) '.tools'),
  [switch]$Force
)
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'

$jdkDir   = Join-Path $Tools 'jdk-17'
$sdkDir   = Join-Path $Tools 'android-sdk'
$cmdTools = Join-Path $sdkDir 'cmdline-tools\latest'

function Say($m) { Write-Host "[setup-android] $m" -ForegroundColor Cyan }
$repoRoot = Split-Path -Parent $PSScriptRoot
$nodeExe = if (Test-Path (Join-Path $repoRoot '..\node.exe')) { (Join-Path $repoRoot '..\node.exe') } else { 'node' }
function Get-File($url, $out) {
  if ((Test-Path $out) -and -not $Force) { Say "已存在，跳过下载：$out"; return }
  Say "下载 $url"
  New-Item -ItemType Directory -Force -Path (Split-Path -Parent $out) | Out-Null
  & $nodeExe (Join-Path $PSScriptRoot 'dl.js') $url $out
  if ($LASTEXITCODE -ne 0) { throw "下载失败：$url" }
  Say ("完成 {0:N1} MB" -f ((Get-Item $out).Length / 1MB))
}

New-Item -ItemType Directory -Force -Path $Tools | Out-Null

# ---------- 1. JDK 17 ----------
if (-not (Test-Path (Join-Path $jdkDir 'bin\java.exe'))) {
  $jdkZip = Join-Path $Tools 'jdk17.zip'
  # 华为云镜像（国内可达，实测 ~4.4 MB/s）；官方 Adoptium 在本网络下会被重置
  Get-File 'https://mirrors.huaweicloud.com/openjdk/17.0.2/openjdk-17.0.2_windows-x64_bin.zip' $jdkZip
  Say '解压 JDK...'
  $tmp = Join-Path $Tools '_jdk_tmp'
  Remove-Item $tmp -Recurse -Force -ErrorAction SilentlyContinue
  Expand-Archive -Path $jdkZip -DestinationPath $tmp -Force
  $inner = (Get-ChildItem $tmp -Directory | Select-Object -First 1).FullName
  Remove-Item $jdkDir -Recurse -Force -ErrorAction SilentlyContinue
  Move-Item $inner $jdkDir
  Remove-Item $tmp -Recurse -Force -ErrorAction SilentlyContinue
  Remove-Item $jdkZip -Force -ErrorAction SilentlyContinue
} else { Say 'JDK 已存在，跳过' }
$env:JAVA_HOME = $jdkDir
Say ("JAVA_HOME = " + $env:JAVA_HOME)
& (Join-Path $jdkDir 'bin\java.exe') -version

# ---------- 2. Android command-line tools ----------
if (-not (Test-Path (Join-Path $cmdTools 'bin\sdkmanager.bat'))) {
  $cmdZip = Join-Path $Tools 'cmdline-tools.zip'
  Get-File 'https://dl.google.com/android/repository/commandlinetools-win-11076708_latest.zip' $cmdZip
  Say '解压 command-line tools...'
  $tmp = Join-Path $Tools '_cmd_tmp'
  Remove-Item $tmp -Recurse -Force -ErrorAction SilentlyContinue
  Expand-Archive -Path $cmdZip -DestinationPath $tmp -Force
  New-Item -ItemType Directory -Force -Path (Split-Path -Parent $cmdTools) | Out-Null
  Remove-Item $cmdTools -Recurse -Force -ErrorAction SilentlyContinue
  Move-Item (Join-Path $tmp 'cmdline-tools') $cmdTools
  Remove-Item $tmp -Recurse -Force -ErrorAction SilentlyContinue
  Remove-Item $cmdZip -Force -ErrorAction SilentlyContinue
} else { Say 'command-line tools 已存在，跳过' }

# ---------- 3. SDK 组件 ----------
$env:ANDROID_HOME = $sdkDir
$env:ANDROID_SDK_ROOT = $sdkDir
$sdkmanager = Join-Path $cmdTools 'bin\sdkmanager.bat'
Say '接受 SDK 许可协议...'
$yes = ('y' + [Environment]::NewLine) * 40
$yes | & $sdkmanager --sdk_root=$sdkDir --licenses | Out-Null
Say '安装 platform-tools / platforms;android-34 / build-tools;34.0.0 ...'
& $sdkmanager --sdk_root=$sdkDir 'platform-tools' 'platforms;android-34' 'build-tools;34.0.0' | Out-Null

# ---------- 4. 生成 local.properties ----------
$androidProj = Join-Path (Split-Path -Parent $PSScriptRoot) 'android-app\android'
if (Test-Path $androidProj) {
  $lp = Join-Path $androidProj 'local.properties'
  Set-Content -Path $lp -Value ("sdk.dir=" + ($sdkDir -replace '\\', '\\')) -Encoding ASCII
  Say "已写入 $lp"
}

Say '工具链就绪 ✅'
Say "JDK:     $jdkDir"
Say "SDK:     $sdkDir"
Say ''
Say '下一步：powershell -ExecutionPolicy Bypass -File scripts\build-apk.ps1'
