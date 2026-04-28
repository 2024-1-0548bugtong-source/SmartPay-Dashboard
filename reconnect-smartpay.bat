@echo off
setlocal

set "COM_PORT=COM5"
set "VERCEL_URL=https://smartpay-dashboard-two.vercel.app"

cd /d "%~dp0"

echo.
set /p COM_PORT=Enter COM port for Arduino [%COM_PORT%]: 
if "%COM_PORT%"=="" set "COM_PORT=COM5"

start "SmartPay Dashboard" "%VERCEL_URL%"

echo Starting SmartPay bridge on %COM_PORT% and sending to %VERCEL_URL%
echo Close Arduino Serial Monitor if the COM port is busy.
echo.

npm run bridge:vercel -- %COM_PORT% %VERCEL_URL%

endlocal