@echo off
chcp 65001 >nul
title 清风聊天 V1.1
echo.
echo ================================
echo       清风聊天 V1.1
echo ================================
echo.
where node >nul 2>nul
if errorlevel 1 (
 echo [错误] 未安装 Node.js。
 echo 请安装 Node.js LTS 后再次运行。
 pause
 exit /b 1
)
echo Node.js:
node --version
echo.
echo 正在安装依赖，第一次运行可能需要几分钟...
call npm install
if errorlevel 1 (
 echo.
 echo [错误] 依赖安装失败。
 echo 请检查网络，然后重新双击 start.bat。
 pause
 exit /b 1
)
echo.
echo 正在启动服务器...
start "" http://localhost:3000
npm start
pause
