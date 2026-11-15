@echo off
rem One-click launcher: installs deps, seeds the DB on first run, builds the UI and starts the server.
cd /d "%~dp0"
if not exist node_modules call npm install --no-audit --no-fund
if not exist data\school.db call npm run db:reset
if not exist client\dist call npm run build
start "" http://localhost:3000
call npm start
