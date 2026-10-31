@echo off
rem Luminoctis installer: double-click. Arguments (-Uninstall, -Yes, -ProfileDir ...) are passed through.
chcp 65001 >nul
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0installer\install.ps1" %*
echo.
pause
