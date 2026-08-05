@ECHO OFF
SETLOCAL
SET "SCRIPT=%~dp0build-apk.ps1"
powershell -NoProfile -ExecutionPolicy Bypass -File "%SCRIPT%"
PAUSE
