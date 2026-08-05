#!/bin/bash
# 灵屏播放端 APK 构建（release）
set -e
cd "$(dirname "$0")"

if [ ! -f keystore.properties ]; then
  echo "[WARN] keystore.properties not found - building UNSIGNED release."
  echo "        Copy keystore.properties.template to keystore.properties and fill in your key."
  echo "        See docs/07 section 6 (构建 APK 环境与步骤)."
fi

if [ -f gradlew ]; then
  ./gradlew assembleRelease
elif command -v gradle >/dev/null 2>&1; then
  echo "[INFO] gradlew not found, using system gradle."
  gradle assembleRelease
else
  echo "[ERROR] Neither gradlew nor gradle found."
  echo "  Option 1 (recommended): open this folder in Android Studio, it generates the wrapper automatically."
  echo "  Option 2: install Gradle, run 'gradle wrapper', then run this script again."
  echo "  See docs/07 section 6."
  exit 1
fi

echo "APK: app/build/outputs/apk/release/app-release.apk"
