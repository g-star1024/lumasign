#!/usr/bin/env bash
# 监视 LumaSign v1.3.28 GitHub Release 并下载 APK 到 Downloads（带 token 认证，避免匿名限流）
set -u
REPO="g-star1024/lumasign"
TAG="v1.3.28"
DEST="/c/Users/DMax/Downloads"
LOG="$DEST/lumasign_release_monitor.log"
mkdir -p "$DEST"
API="https://api.github.com"

# 从 git 凭据管理器取 token（自包含，不依赖外部传入）
TOKEN=$(printf "protocol=https\nhost=github.com\n" | git -c http.sslVerify=false credential fill 2>/dev/null | awk -F= '/^password=/{print $2}')
AUTH=""
if [ -n "$TOKEN" ]; then AUTH="-H Authorization:Bearer $TOKEN"; fi

echo "$(date) monitor start for $TAG (auth=${AUTH:+on})" > "$LOG"

for ((i=1; i<=80; i++)); do
  RESP=$(curl -sS --max-time 30 --ssl-no-revoke $AUTH "$API/repos/$REPO/releases/tags/$TAG" 2>/dev/null)
  if echo "$RESP" | grep -q '"tag_name"'; then
    echo "$(date) release found" >> "$LOG"
    echo "$RESP" | python3 -c "
import sys,json
d=json.load(sys.stdin)
for a in d.get('assets',[]):
    print(a['name'], a['browser_download_url'])
" 2>/dev/null | tee -a "$LOG"

    DL=0
    echo "$RESP" | python3 -c "
import sys,json
d=json.load(sys.stdin)
for a in d.get('assets',[]):
    n=a['name']
    if n.endswith('-release.apk') and ('armeabi-v7a' in n or 'universal' in n):
        print(a['browser_download_url'])
" 2>/dev/null | while read url; do
      fn=$(basename "$url")
      echo "$(date) downloading $fn" >> "$LOG"
      curl -sS --max-time 180 --ssl-no-revoke -L -o "$DEST/$fn" "$url" >> "$LOG" 2>&1
      echo "$(date) saved $DEST/$fn ($(stat -c%s "$DEST/$fn" 2>/dev/null) bytes)" >> "$LOG"
    done

    if ls "$DEST"/LumaSign-android-$TAG-*-release.apk >/dev/null 2>&1; then
      echo "$(date) DONE: APKs present" >> "$LOG"
      ls -la "$DEST"/LumaSign-android-$TAG-*-release.apk >> "$LOG"
      exit 0
    fi
  else
    echo "$(date) attempt $i: release not ready" >> "$LOG"
  fi
  sleep 30
done
echo "$(date) TIMEOUT after $((80*30))s" >> "$LOG"
exit 1
