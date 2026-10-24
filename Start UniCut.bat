@echo off
setlocal
title Start UniCut
cd /d "%~dp0"
if not defined UNICUT_PORT set "UNICUT_PORT=7860"

docker compose version >nul 2>&1
if errorlevel 1 (
    echo Install Docker Desktop from https://www.docker.com/products/docker-desktop/ first.
    pause
    exit /b 1
)

docker info >nul 2>&1
if errorlevel 1 (
    echo Open Docker Desktop, wait until it is running, then try again.
    pause
    exit /b 1
)

echo Starting UniCut. The first setup can take several minutes.
docker compose up --build --wait --wait-timeout 300
if errorlevel 1 (
    echo UniCut could not start. Check the messages below.
    docker compose logs --tail 40
    pause
    exit /b 1
)

start "" "http://127.0.0.1:%UNICUT_PORT%"
echo UniCut is running at http://127.0.0.1:%UNICUT_PORT%
echo You can close this window. Use Stop UniCut.bat when finished.
pause
