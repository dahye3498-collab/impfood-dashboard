# 이 PC의 자동 수집 예약 작업 삭제 (인수인계 후 기존 PC 정리용)
# 사용법: PowerShell에서  .\scripts\예약해제.ps1
foreach ($t in "impfood-collect-1일", "impfood-collect-15일") {
    schtasks /Delete /F /TN $t 2>$null | Out-Null
    Write-Host "삭제: $t"
}
Write-Host "✅ 예약 작업 해제 완료 — 이 PC에서는 더 이상 자동 수집이 돌지 않습니다"
