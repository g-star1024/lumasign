@echo off
chcp 65001 >nul
cd /d "%~dp0"

where node >nul 2>nul || (
  echo 未检测到 Node.js，请先安装：https://nodejs.org （建议 LTS 18+）
  pause
  exit /b 1
)

REM 国内网络若下载 Electron 慢，可取消下一行注释（用 npmmirror 镜像）
REM set ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/

echo ============================================
echo  灵屏 LumaSign · 打包离线安装包（Windows）
echo  产物在 dist\ 目录，可离线拷贝到任意电脑安装
echo ============================================
echo.

if exist node_modules\electron (
  echo 检测到已安装 Electron，跳过下载…
) else (
  echo 首次运行会下载 Electron（约 100MB+），请稍候…
  call npm install
  if errorlevel 1 (
    echo.
    echo [失败] npm install 出错，请检查网络后重试
    pause
    exit /b 1
  )
)

echo.
echo 正在打包离线安装包（nsis + zip）…
echo.
call npm run dist:win
if errorlevel 1 (
  echo.
  echo [失败] 打包出错，请查看上方日志
  pause
  exit /b 1
)

echo.
echo 打包完成！离线安装包在 dist\ 目录下：
echo   - 灵屏 LumaSign Setup *.exe   （双击安装，无需联网）
echo   - 灵屏 LumaSign *.zip         （绿色版，解压即用）
echo.
echo 把 dist\ 里的文件拷到目标电脑即可离线部署。
pause
