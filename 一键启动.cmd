@echo off
setlocal
chcp 65001 >nul
title Pet Arena

powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\start-local.ps1"
if errorlevel 1 (
  echo.
  echo [ERROR] Server startup failed. Check the message above.
  pause
  exit /b 1
)

start "" "http://localhost:3000/"
if errorlevel 1 (
  echo [ERROR] Could not open the browser. Open http://localhost:3000/ manually.
  pause
  exit /b 1
)
exit /b 0
