@echo off
title Flood Time Machine - offline demo
cd /d "%~dp0"
echo.
echo   FLOOD TIME MACHINE - offline demo
echo   ---------------------------------
echo.

where node >nul 2>nul
if errorlevel 1 (
  echo   Node.js is not installed on this machine.
  echo   Install Node.js LTS from https://nodejs.org and run this file again.
  echo.
  pause
  exit /b 1
)

if not exist "data\score\index.json" (
  echo   Data is missing. Run the pipeline first:
  echo     npm run fetch:basemap ^&^& npm run fetch:terrain ^&^& npm run fetch:flood
  echo     npm run fetch:places ^&^& npm run fetch:rainfall ^&^& npm run build:score ^&^& npm run build:all
  echo.
  pause
  exit /b 1
)

echo   Starting the local server and opening your browser...
echo   Keep this window open during the demo. Close it to stop the server.
echo.
node server.mjs --open
pause
