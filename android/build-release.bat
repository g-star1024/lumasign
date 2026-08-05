@echo off
REM 灵屏播放端 APK 构建（release）
cd /d %~dp0

IF NOT EXIST keystore.properties (
  echo [WARN] keystore.properties not found - building UNSIGNED release.
  echo         Copy keystore.properties.template to keystore.properties and fill in your key.
  echo         See docs/07 section 6 (构建 APK 环境与步骤).
)

IF EXIST gradlew.bat (
  call gradlew.bat assembleRelease
) ELSE (
  where gradle >nul 2>nul
  IF %ERRORLEVEL%==0 (
    echo [INFO] gradlew not found, using system gradle.
    call gradle assembleRelease
  ) ELSE (
    echo [ERROR] Neither gradlew nor gradle found.
    echo   Option 1 (recommended): open this folder in Android Studio, it generates the wrapper automatically.
    echo   Option 2: install Gradle, run "gradle wrapper", then run this script again.
    echo   See docs/07 section 6.
    pause
    exit /b 1
  )
)

echo.
echo APK: app\build\outputs\apk\release\app-release.apk
pause
