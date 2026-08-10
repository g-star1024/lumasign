@echo off
REM ============================================
REM 灵屏安卓端崩溃日志抓取工具
REM 用法：USB 连设备 + 开 USB 调试，双击运行
REM 输出：lumasign_luma_log.txt / lumasign_full_log.txt
REM ============================================
echo.
echo [灵屏] 安卓端崩溃日志抓取
echo ========================================
echo.

if not exist platform-tools (
    echo [1/4] 正在下载 ADB 工具（约 4MB）...
    curl -sL -o platform-tools.zip https://dl.google.com/android/repository/platform-tools-latest-windows.zip
    echo.
    echo [2/4] 正在解压...
    powershell -Command "Expand-Archive -Path platform-tools.zip -DestinationPath platform-tools -Force"
    del /f /q platform-tools.zip
) else (
    echo [1/4] ADB 工具已就绪
)

echo [2/4] 正在检测设备...
cd platform-tools
adb devices
echo.

echo [3/4] 正在抓取日志（请现在打开/重启安卓播放端 APP）...
adb logcat -d | findstr LumaSign > ..\lumasign_luma_log.txt
adb logcat -d > ..\lumasign_full_log.txt
cd ..

echo.
echo [4/4] 完成！日志已保存到当前目录：
echo   lumasign_luma_log.txt  — 仅含 LumaSign 日志（重点看这个）
echo   lumasign_full_log.txt  — 完整日志（上面没内容时翻这个）
echo.
echo 把 lumasign_luma_log.txt 的内容贴给开发者即可定位闪退原因
echo.
pause