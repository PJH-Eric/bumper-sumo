@echo off
chcp 65001 >nul
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo [錯誤] 找不到 Node.js，請先到 https://nodejs.org/ 安裝 Node.js 22 以上版本。
  pause
  exit /b 1
)

if not exist "node_modules" (
  echo 第一次啟動，正在安裝相依套件（只要做一次）…
  call npm install --no-audit --no-fund
  if errorlevel 1 (
    echo [錯誤] 套件安裝失敗，請確認網路連線後再試一次。
    pause
    exit /b 1
  )
)

echo ================================================
echo   碰碰車大亂鬥 - 遊戲伺服器
echo ================================================
echo.
echo   這台電腦開遊戲：  http://localhost:3250
echo   其他電腦／手機請用下面印出的「同網段」網址。
echo   要停止請按 Ctrl+C 或關掉這個視窗。
echo.

start "" /b cmd /c "ping -n 3 127.0.0.1 >nul & start "" http://localhost:3250"

node server.js
echo.
echo 伺服器已停止。
pause
