@echo off
chcp 65001 >nul
title 放行昆特牌端口

REM 自动请求管理员权限
net session >nul 2>&1
if %errorlevel% neq 0 (
  echo 正在请求管理员权限...
  powershell -NoProfile -Command "Start-Process -FilePath '%~f0' -Verb RunAs"
  exit /b
)

echo.
echo 放行 TCP 8080（局域网手机/平板访问用）...
netsh advfirewall firewall delete rule name="Gwent 8080" >nul 2>&1
netsh advfirewall firewall add rule name="Gwent 8080" dir=in action=allow protocol=TCP localport=8080 profile=any
if errorlevel 1 (
  echo [失败] 未能添加规则，请确认是否以管理员身份运行。
) else (
  echo [成功] 已放行 TCP 8080，手机可以访问了。
)

echo.
echo 当前 8080 相关规则：
netsh advfirewall firewall show rule name="Gwent 8080"
echo.
pause
