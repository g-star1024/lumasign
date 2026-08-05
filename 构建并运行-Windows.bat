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
echo  灵屏 LumaSign · 桌面端构建并运行
echo ============================================
echo.

REM 已安装过 Electron 则跳过下载（避免每次联网）
if exist node_modules\electron (
  echo 检测到已安装 Electron，跳过下载，直接启动…
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
echo 依赖安装完成，正在启动桌面端…
echo.
npx electron .
pause
