# ============================================================
# 一键编译 APK（本地，无需 Android Studio）
# 前置：先跑 scripts\setup-android.ps1 装工具链
# 用法（普通 PowerShell 窗口）：
#   powershell -ExecutionPolicy Bypass -File scripts\build-apk.ps1
# 产物：项目根目录 gwent-android-debug.apk
# ============================================================
param(
  [switch]$Clean,
  [switch]$SkipSync
)
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'

$repo = Split-Path -Parent $PSScriptRoot
$tools = Join-Path $repo '.tools'
$jdk = Join-Path $tools 'jdk-17'
$sdk = Join-Path $tools 'android-sdk'
$appDir = Join-Path $repo 'android-app'
$androidDir = Join-Path $appDir 'android'

function Say($m) { Write-Host "[build-apk] $m" -ForegroundColor Cyan }

# ---------- 环境变量（全部指向项目内，避免写到 C 盘被沙箱/权限拒绝） ----------
if (-not (Test-Path (Join-Path $jdk 'bin\java.exe'))) { throw "未找到 JDK，请先运行 scripts\setup-android.ps1" }
if (-not (Test-Path (Join-Path $sdk 'platforms\android-34'))) { throw "未找到 Android SDK，请先运行 scripts\setup-android.ps1" }

$env:JAVA_HOME = $jdk
$env:ANDROID_HOME = $sdk
$env:ANDROID_SDK_ROOT = $sdk
$env:ANDROID_USER_HOME = Join-Path $tools 'android-user'
$env:GRADLE_USER_HOME = Join-Path $tools 'gradle-home'
$env:npm_config_cache = Join-Path $repo '.npm-cache'
New-Item -ItemType Directory -Force -Path $env:ANDROID_USER_HOME, $env:GRADLE_USER_HOME | Out-Null
Say "JAVA_HOME=$env:JAVA_HOME"
Say "ANDROID_HOME=$env:ANDROID_HOME"
Say "GRADLE_USER_HOME=$env:GRADLE_USER_HOME"

$nodeExe = if (Test-Path (Join-Path $repo '..\node.exe')) { (Join-Path $repo '..\node.exe') } else { 'node' }
$npmCmd = if (Test-Path (Join-Path $repo '..\npm.cmd')) { (Join-Path $repo '..\npm.cmd') } else { 'npm' }

# ---------- 1. 准备网页资源 ----------
Say '准备网页资源 → android-app/www'
& $nodeExe (Join-Path $PSScriptRoot 'prepare-www.js')

# ---------- 2. 依赖 ----------
if (-not (Test-Path (Join-Path $appDir 'node_modules\@capacitor\cli'))) {
  Say '安装 Capacitor 依赖（npm install）'
  Push-Location $appDir
  & $npmCmd install --no-audit --no-fund
  Pop-Location
} else { Say '依赖已存在，跳过 npm install' }

# ---------- 3. 生成 Android 工程 ----------
if (-not (Test-Path $androidDir)) {
  Say '生成 Android 工程（cap add android）'
  Push-Location $appDir
  & $npmCmd exec -- cap add android
  Pop-Location
} else { Say 'Android 工程已存在' }

# ---------- 4. Gradle 走国内镜像 ----------
$wrap = Join-Path $androidDir 'gradle\wrapper\gradle-wrapper.properties'
if (Test-Path $wrap) {
  $txt = Get-Content $wrap -Raw
  $txt = $txt -replace 'https\\://services\.gradle\.org/distributions/', 'https\://mirrors.cloud.tencent.com/gradle/'
  Set-Content -Path $wrap -Value $txt -Encoding ASCII
  Say 'Gradle 下载地址已切换到腾讯镜像'
}

# ---------- 4.5 版本号跟随根 package.json ----------
$ver = (Get-Content (Join-Path $repo 'package.json') -Raw | ConvertFrom-Json).version
$gradleFile = Join-Path $androidDir 'app\build.gradle'
if ((Test-Path $gradleFile) -and $ver) {
  $code = [int]((($ver -split '\.') | ForEach-Object { $_.PadLeft(2, '0') }) -join '')
  if ($code -lt 1) { $code = 1 }
  $g = Get-Content $gradleFile -Raw
  $g = $g -replace 'versionCode \d+', "versionCode $code"
  $g = $g -replace 'versionName ".*?"', "versionName `"$ver`""
  Set-Content -Path $gradleFile -Value $g -Encoding ASCII
  Say "Android 版本：versionCode=$code  versionName=$ver"
}

# ---------- 5. 图标与启动图 ----------
Say '生成 Android 图标与启动图（自带生成器，不依赖 sharp）'
& $nodeExe (Join-Path $PSScriptRoot 'make-icons.js') | Out-Null
& $nodeExe (Join-Path $PSScriptRoot 'make-android-icons.js')

# ---------- 6. 同步网页资源 ----------
if (-not $SkipSync) {
  Say '同步网页资源（cap sync android）'
  Push-Location $appDir
  & $npmCmd exec -- cap sync android
  Pop-Location
}

# ---------- 7. local.properties ----------
$lp = Join-Path $androidDir 'local.properties'
Set-Content -Path $lp -Value ("sdk.dir=" + ($sdk -replace '\\', '\\')) -Encoding ASCII
Say "已写入 $lp"

# ---------- 8. 编译 ----------
Say '开始编译 APK（首次会下载 Gradle 与依赖，约 3-10 分钟）'
Push-Location $androidDir
if ($Clean) { & '.\gradlew.bat' clean --no-daemon }
& '.\gradlew.bat' assembleDebug --no-daemon
$code = $LASTEXITCODE
Pop-Location
if ($code -ne 0) { throw "Gradle 编译失败（exit $code）" }

$apk = Join-Path $androidDir 'app\build\outputs\apk\debug\app-debug.apk'
if (-not (Test-Path $apk)) { throw "未找到 APK：$apk" }
$out = Join-Path $repo 'gwent-android-debug.apk'
Copy-Item $apk $out -Force
Say ("编译完成 ✅  {0}  ({1:N1} MB)" -f $out, ((Get-Item $out).Length / 1MB))
