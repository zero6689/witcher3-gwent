@echo off
REM 静默启动昆特牌服务器（供计划任务 / 开机自启调用，无窗口）
cd /d "%~dp0"
set "NODE=node"
if exist "%~dp0..\node.exe" set "NODE=%~dp0..\node.exe"
"%NODE%" server.js 8080 >> "%~dp0server.log" 2>&1
