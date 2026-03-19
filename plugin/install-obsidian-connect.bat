@echo off
setlocal
set SCRIPT_DIR=%~dp0
powershell -NoProfile -ExecutionPolicy Bypass -STA -File "%SCRIPT_DIR%install-obsidian-connect.ps1"
endlocal
