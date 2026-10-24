@echo off
setlocal
title Stop UniCut
cd /d "%~dp0"
docker compose stop
if errorlevel 1 (
    echo Could not stop UniCut. Make sure Docker Desktop is running.
    pause
    exit /b 1
)
echo UniCut has stopped. Downloaded model files are kept for next time.
pause
