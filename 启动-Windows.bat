@echo off
chcp 65001 >nul
cd /d "%~dp0"

where node >nul 2>nul || (
  echo 未检测到 Node.js，请先安装：https://nodejs.org （建议 LTS 18+）
  pause
  exit /b 1
)

REM 防止双击时重复启动：占用 7788 端口即视为已运行
set PORT=7788
powershell -NoProfile -Command "if (Test-NetConnection -ComputerName 127.0.0.1 -Port %PORT% -WarningAction SilentlyContinue).TcpTestSucceeded { exit 0 } else { exit 1 }" >nul 2>nul
if %errorlevel%==0 (
  echo 灵屏 LumaSign 已在运行，直接打开管理端…
  start http://localhost:%PORT%/
  exit /b 0
)

echo 灵屏 LumaSign 启动中…
echo 管理端： http://localhost:%PORT%/
echo 终端发现：UDP 7789
echo 关闭此窗口即可停止服务
echo.

REM 后台启动服务端，启动后自动打开浏览器
start "" cmd /c "node server/server.js & timeout /t 3 >nul & start http://localhost:%PORT%/"
echo 正在打开管理端，请稍候…
pause >nul
