# 매월 자동 수집 예약 작업 등록 (새 PC 셋업용 — 한 번만 실행)
# 사용법: PowerShell에서  .\scripts\예약등록.ps1
# 매월 1일·15일 10:00에 수집이 돌고, PC가 꺼져 있었으면 다음 부팅 때 실행됩니다.
$ErrorActionPreference = "Stop"
$script = Join-Path $PSScriptRoot "monthly-collect.ps1"
if (-not (Test-Path $script)) { Write-Host "monthly-collect.ps1 을 찾을 수 없습니다"; exit 1 }
$action = "powershell.exe -NoProfile -ExecutionPolicy Bypass -File `"$script`""

schtasks /Create /F /SC MONTHLY /D 1  /TN "impfood-collect-1일"  /TR $action /ST 10:00 | Out-Null
schtasks /Create /F /SC MONTHLY /D 15 /TN "impfood-collect-15일" /TR $action /ST 10:00 | Out-Null

# PC가 꺼져 있었으면 부팅 후 실행 + 배터리 상태에서도 실행
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -DontStopIfGoingOnBatteries
Set-ScheduledTask -TaskName "impfood-collect-1일"  -Settings $settings | Out-Null
Set-ScheduledTask -TaskName "impfood-collect-15일" -Settings $settings | Out-Null

Write-Host "✅ 예약 작업 등록 완료 (매월 1일·15일 10:00)"
Write-Host "   대상 스크립트: $script"
Write-Host "   테스트: scripts\수집실행.cmd 더블클릭 → logs 폴더에서 로그 확인"
