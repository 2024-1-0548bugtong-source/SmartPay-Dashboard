@echo off
setlocal

set "COM_PORT=COM5"
set "VERCEL_URL=https://honest-pay-dashboard.vercel.app"

cd /d "%~dp0"

echo Stopping stale SmartPay bridge processes if they are still running...
powershell -NoProfile -ExecutionPolicy Bypass -Command "$patterns = @('bridge-json-vercel.js','gateway.js'); Get-CimInstance Win32_Process | Where-Object { $_.Name -eq 'node.exe' -and $null -ne $_.CommandLine -and ($patterns | Where-Object { $_cmd = $_; $_.CommandLine -like ('*' + $_cmd + '*') }).Count -gt 0 } | ForEach-Object { Write-Host (' - stopping PID ' + $_.ProcessId + ' :: ' + $_.CommandLine); Stop-Process -Id $_.ProcessId -Force }" 2>nul

echo.
set /p COM_PORT=Enter COM port for Arduino [%COM_PORT%]: 
if "%COM_PORT%"=="" set "COM_PORT=COM5"

start "SmartPay Dashboard" "%VERCEL_URL%"

echo Starting SmartPay bridge on %COM_PORT% and sending to %VERCEL_URL%
echo Close Arduino Serial Monitor if the COM port is busy.
echo.

npm run bridge:vercel -- %COM_PORT% %VERCEL_URL%

endlocal