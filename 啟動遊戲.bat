@echo off
rem Bumper Brawl launcher. Keep this file ASCII-only: cmd.exe misreads UTF-8 lines after chcp 65001.
rem All Chinese messages are printed by scripts\start.js or scripts\msg-*.txt.
chcp 65001 >nul
setlocal
cd /d "%~dp0"

set "NODE_EXE="
set "NODEVER="
for /f "delims=" %%V in ('node -v 2^>nul') do set "NODEVER=%%V"
if defined NODEVER if "%NODEVER:~0,4%"=="v26." set "NODE_EXE=node"

rem PATH node is not 26.x: look for Node 26 installed by nvm-windows
if not defined NODE_EXE if defined NVM_HOME for /d %%D in ("%NVM_HOME%\v26.*") do if exist "%%D\node.exe" set "NODE_DIR=%%D"
if not defined NODE_EXE if not defined NODE_DIR for /d %%D in ("%APPDATA%\nvm\v26.*") do if exist "%%D\node.exe" set "NODE_DIR=%%D"
if not defined NODE_EXE if defined NODE_DIR (
  set "PATH=%NODE_DIR%;%PATH%"
  set "NODE_EXE=%NODE_DIR%\node.exe"
)

if not defined NODE_EXE (
  type "scripts\msg-need-node.txt"
  if defined NODEVER echo   Current: %NODEVER%
  echo.
  pause
  exit /b 1
)

if not exist "node_modules" (
  type "scripts\msg-install.txt"
  call npm install --no-audit --no-fund
  if errorlevel 1 (
    type "scripts\msg-install-fail.txt"
    pause
    exit /b 1
  )
)

"%NODE_EXE%" scripts\start.js
echo.
pause
