@echo off
chcp 65001 >nul
title 昆特牌服务器
cd /d "%~dp0"

set "NODE=node"
if exist "%~dp0..\node.exe" set "NODE=%~dp0..\node.exe"

"%NODE%" --version >nul 2>&1
if errorlevel 1 (
  echo [错误] 找不到 node.exe，请先安装 Node.js，或把 node.exe 放到项目上一级目录。
  pause
  exit /b 1
)

echo.
echo 正在启动昆特牌服务器（按 Ctrl+C 停止）...
echo.
"%NODE%" server.js %*

echo.
echo 服务器已停止。
pause
