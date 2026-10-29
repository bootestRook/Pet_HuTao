@echo off
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\start-local.ps1"
if errorlevel 1 (
  pause
  exit /b 1
)
start "" "http://localhost:3000/"
