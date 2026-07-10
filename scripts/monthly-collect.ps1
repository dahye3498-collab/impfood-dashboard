# 매월 자동 수집 (윈도우 예약 작업용)
# 식약처 API가 해외 IP를 차단해서 GitHub Actions 대신 로컬에서 수집한다.
$ErrorActionPreference = "Continue"
$repo = "C:\dev\impfood-dashboard"
$logDir = Join-Path $repo "logs"
if (-not (Test-Path $logDir)) { New-Item -ItemType Directory $logDir | Out-Null }
$log = Join-Path $logDir ("collect-" + (Get-Date -Format "yyyyMM") + ".log")

function Log($msg) { "$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss') $msg" | Out-File $log -Append -Encoding utf8 }

Set-Location $repo
Log "=== 수집 시작 ==="

git pull --rebase origin main *>> $log
node scripts/collect.mjs --replace *>> $log
if ($LASTEXITCODE -ne 0) { Log "수집 실패 (exit $LASTEXITCODE)"; exit 1 }

git add data
git diff --cached --quiet
if ($LASTEXITCODE -ne 0) {
    git commit -m ("데이터 수집: " + (Get-Date -Format "yyyy-MM-dd")) *>> $log
    git push origin main *>> $log
    Log "커밋·푸시 완료"
} else {
    Log "변경 없음"
}
Log "=== 완료 ==="
