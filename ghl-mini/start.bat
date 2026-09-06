@echo off
REM Double-click this to run ghl-mini. No terminal knowledge needed.
title ghl-mini
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo   Node is not installed.
  echo.
  echo   Go to https://nodejs.org and download the big green LTS button,
  echo   run the installer, then double-click this file again.
  echo.
  pause
  exit /b 1
)

for /f "delims=" %%v in ('node -p "process.versions.node.split('.').slice(0,2).map(Number).join(' ')"') do set NODEVER=%%v
for /f "tokens=1,2" %%a in ("%NODEVER%") do (
  set MAJOR=%%a
  set MINOR=%%b
)
if %MAJOR% LSS 22 goto oldnode
if %MAJOR% EQU 22 if %MINOR% LSS 5 goto oldnode

echo.
echo   Starting ghl-mini...
echo   Leave this window open. Close it to stop the app.
echo.
node server/index.js
echo.
echo   ghl-mini has stopped.
pause
exit /b 0

:oldnode
echo.
echo   Your Node is too old. This needs version 22.5 or newer.
node -v
echo.
echo   Get the LTS build from https://nodejs.org, install it,
echo   then double-click this file again.
echo.
pause
exit /b 1
