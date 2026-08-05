# LumaSign Player - One-click APK builder (Windows)
# Downloads JDK17 + Android SDK + Gradle, then builds app-debug.apk.
# Uses curl.exe (Windows built-in) with multi-mirror fallback.
# No pre-installed tools required. Run via build-apk.bat (double-click).
$ErrorActionPreference = 'Stop'

$ProjectDir = Split-Path -Parent $MyInvocation.MyCommand.Definition
$AndroidDir = Join-Path $ProjectDir 'android'

# Pick a drive with >25 GB free (avoid a full C:)
$drive = (Get-PSDrive -PSProvider FileSystem | Where-Object { $_.Free -gt 25GB } | Sort-Object Free -Descending | Select-Object -First 1).Name
if (-not $drive) { $drive = 'D' }
Write-Host "Using drive $drive`: for toolchain."
$ToolRoot = "$drive`:\lumasign-build"
$sdkRoot  = Join-Path $ToolRoot 'android-sdk'
New-Item -ItemType Directory -Force -Path $ToolRoot, $sdkRoot | Out-Null

# --- Download with curl.exe, auto-retry with multiple URLs ---
function Get-File($urls, $out, $label) {
    if (Test-Path $out) {
        $size = [math]::Round((Get-Item $out).Length / 1MB, 1)
        Write-Host "  [cached] $label ($size MB)"
        return
    }
    Write-Host "  Downloading $label ..."
    foreach ($url in $urls) {
        Write-Host "    Trying: $([Uri]$url).Host ..."
        # Try 1: bypass proxy completely (--noproxy *)
        $exitCode = (Start-Process -FilePath 'curl.exe' -ArgumentList @(
            '-L', '--connect-timeout', '20', '--max-time', '600',
            '-o', $out, '--progress-bar', '--noproxy', '*', $url
        ) -NoNewWindow -Wait -PassThru).ExitCode
        if ($exitCode -eq 0 -and (Test-Path $out) -and (Get-Item $out).Length -gt 1000) {
            $size = [math]::Round((Get-Item $out).Length / 1MB, 1)
            Write-Host "    OK ($size MB) [direct]"
            return
        }
        if (Test-Path $out) { Remove-Item $out -Force -ErrorAction SilentlyContinue }
        # Try 2: go through system proxy
        Write-Host "    Direct failed, trying via proxy ..."
        $exitCode2 = (Start-Process -FilePath 'curl.exe' -ArgumentList @(
            '-L', '--connect-timeout', '20', '--max-time', '600',
            '-o', $out, '--progress-bar', $url
        ) -NoNewWindow -Wait -PassThru).ExitCode
        if ($exitCode2 -eq 0 -and (Test-Path $out) -and (Get-Item $out).Length -gt 1000) {
            $size = [math]::Round((Get-Item $out).Length / 1MB, 1)
            Write-Host "    OK ($size MB) [proxy]"
            return
        }
        if (Test-Path $out) { Remove-Item $out -Force -ErrorAction SilentlyContinue }
        Write-Host "    Skipped (curl exit $exitCode / $exitCode2)"
    }
    throw "All download sources failed for: $label"
}

# ============================================================
# 1) JDK 17 (Eclipse Temurin) - multiple mirror sources
# ============================================================
$jdkZip = Join-Path $ToolRoot 'jdk17.zip'
Get-File @(
    # Source A: Tencent Cloud Mirror (fastest in China)
    'https://mirrors.cloud.tencent.com/Adoptium/17/jdk/x64/windows/OpenJDK17U-jdk_x64_windows_hotspot_17.0.12_7.zip'
    # Source B: Aliyun Mirror
    'https://mirrors.aliyun.com/adoptium/17/jdk/x64/windows/OpenJDK17U-jdk_x64_windows_hotspot_17.0.12_7.zip'
    # Source C: Official (via proxy as last resort)
    'https://api.adoptium.net/v3/binary/latest/17/ga/windows/x64/jdk/zip'
) $jdkZip 'JDK 17 (Temurin)'
$jdkHome = Join-Path $ToolRoot 'jdk'
if (-not (Test-Path (Join-Path $jdkHome 'bin\java.exe'))) {
    Write-Host 'Extracting JDK...'
    Expand-Archive -Path $jdkZip -DestinationPath (Join-Path $ToolRoot 'jdk-tmp') -Force
    $jdkHome = (Get-ChildItem (Join-Path $ToolRoot 'jdk-tmp') -Directory | Select-Object -First 1).FullName
}
Write-Host "JDK home: $jdkHome"

# ============================================================
# 2) Android command-line tools (Google - already whitelisted)
# ============================================================
$ctZip = Join-Path $ToolRoot 'cmdline-tools.zip'
Get-File @(
    'https://dl.google.com/android/repository/commandlinetools-win-11076708_latest.zip'
) $ctZip 'Android CMD Tools'
$ctDir = Join-Path $ToolRoot 'ct'
if (-not (Test-Path (Join-Path $ctDir 'cmdline-tools\bin\sdkmanager.bat'))) {
    Write-Host 'Extracting command-line tools...'
    Expand-Archive -Path $ctZip -DestinationPath $ctDir -Force
}
$sdkmanager = Join-Path $ctDir 'cmdline-tools\bin\sdkmanager.bat'

# ============================================================
# 3) SDK packages
# ============================================================
Write-Host 'Installing SDK packages (platform-tools, android-34, build-tools)...'
$env:JAVA_HOME = $jdkHome
$env:ANDROID_HOME = $sdkRoot
# Accept licenses first, then install
$yesInput = 'y' * 20
cmd /c "($yesInput) | `"$sdkmanager`" --sdk_root=`"$sdkRoot`" --licenses" 2>&1 | Out-Null
cmd /c "`"$sdkmanager`" --sdk_root=`"$sdkRoot`" `"platform-tools`" `"platforms;android-34`" `"build-tools;34.0.0`""

# ============================================================
# 4) Gradle 8.6 - multiple mirror sources
# ============================================================
$gradleZip = Join-Path $ToolRoot 'gradle.zip'
Get-File @(
    # Source A: Tencent Cloud Mirror
    'https://mirrors.cloud.tencent.com/gradle/gradle-8.6-bin.zip'
    # Source B: Aliyun Mirror
    'https://mirrors.aliyun.com/gradle/gradle-8.6-bin.zip'
    # Source C: Official Gradle CDN
    'https://services.gradle.org/distributions/gradle-8.6-bin.zip'
) $gradleZip 'Gradle 8.6'
$gradleHome = Join-Path $ToolRoot 'gradle'
if (-not (Test-Path (Join-Path $gradleHome 'bin\gradle.bat'))) {
    Write-Host 'Extracting Gradle...'
    Expand-Archive -Path $gradleZip -DestinationPath $gradleHome -Force
}
$gradleBat = (Get-ChildItem (Join-Path $gradleHome 'bin\gradle.bat') -Recurse | Select-Object -First 1).FullName
Write-Host "Gradle: $gradleBat"

# ============================================================
# 5) Build debug APK
# ============================================================
Write-Host 'Building app-debug.apk ...'
Write-Host '(first build will download Kotlin/AGP dependencies from mavenCentral/google - be patient)'
cmd /c "`"$gradleBat`" -p `"$AndroidDir`" assembleDebug --no-daemon --stacktrace"

$apk = Join-Path $AndroidDir 'app\build\outputs\apk\debug\app-debug.apk'
if (Test-Path $apk) {
    $size = [math]::Round((Get-Item $apk).Length / 1MB, 1)
    Write-Host ""
    Write-Host "============================================"
    Write-Host "SUCCESS! APK built:"
    Write-Host "  $apk"
    Write-Host "  Size: $size MB"
    Write-Host "============================================"
} else {
    Write-Host ""
    Write-Host "BUILD FAILED - see errors above."
    Write-Host "Tips:"
    Write-Host "  - Make sure you can open https://repo1.maven.org in your browser"
    Write-Host "  - If Gradle deps fail, try running again (some may need retry)"
}
