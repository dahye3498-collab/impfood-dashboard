@echo off
rem 더블클릭으로 수동 수집 실행
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0monthly-collect.ps1"
echo.
echo 완료. 로그: logs 폴더 확인
pause
