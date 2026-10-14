@echo off
rem squash-ai-coach local server. ASCII only (cmd reads .bat as CP949).
cd /d "%~dp0"
title squash-ai-coach server :8780

where python >nul 2>nul
if errorlevel 1 (
  echo [ERROR] python was not found on PATH. Install Python 3 and try again.
  pause
  exit /b 1
)

netstat -ano | findstr /r /c:":8780 .*LISTENING" >nul
if not errorlevel 1 (
  curl -sf -o nul http://127.0.0.1:8780/app/angles.mjs
  if not errorlevel 1 (
    echo [INFO] The squash-ai-coach server is already running. Opening the app.
    start http://localhost:8780/app/
    timeout /t 3 >nul
    exit /b 0
  )
  echo [ERROR] Port 8780 is used by another program:
  netstat -ano | findstr /r /c:":8780 .*LISTENING"
  echo Stop it with: taskkill /PID 12345 /F   - use the number in the last column above
  echo Then run start.bat again.
  pause
  exit /b 1
)

echo Serving %CD%
echo   App:       http://localhost:8780/app/
echo   Dashboard: http://localhost:8780/docs/
echo Keep this window open while you work. Press Ctrl+C or close the window to stop.
echo.
start "" /min cmd /c "ping -n 3 127.0.0.1 >nul & start http://localhost:8780/app/"
call python -m http.server 8780 --bind 127.0.0.1

echo.
echo [ERROR] The server stopped (exit code %errorlevel%). Read the message above.
pause
