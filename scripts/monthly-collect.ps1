# 매월 자동 수집 (윈도우 예약 작업용)
# 식약처 API가 해외 IP를 차단해서 GitHub Actions 대신 로컬에서 수집한다.
$ErrorActionPreference = "Continue"
$repo = "C:\dev\impfood-dashboard"
$logDir = Join-Path $repo "logs"
if (-not (Test-Path $logDir)) { New-Item -ItemType Directory $logDir | Out-Null }
$log = Join-Path $logDir ("collect-" + (Get-Date -Format "yyyyMM") + ".log")

function Log($msg) { "$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss') $msg" | Add-Content $log -Encoding UTF8 }
function Run($exe, $arguments) {
    # 네이티브 명령 출력을 UTF-8로 통일해서 로그에 남긴다
    $out = & $exe @arguments 2>&1 | ForEach-Object { "$_" }
    if ($out) { $out | Add-Content $log -Encoding UTF8 }
    return $LASTEXITCODE
}

Set-Location $repo
[Console]::OutputEncoding = [Text.Encoding]::UTF8
Log "=== 수집 시작 ==="

Run git @("pull", "--rebase", "origin", "main") | Out-Null
if ((Run node @("scripts/collect.mjs", "--replace")) -ne 0) { Log "수집 실패"; exit 1 }

Run git @("add", "data") | Out-Null
git diff --cached --quiet
if ($LASTEXITCODE -ne 0) {
    Run git @("commit", "-m", ("데이터 수집: " + (Get-Date -Format "yyyy-MM-dd"))) | Out-Null
    if ((Run git @("push", "origin", "main")) -ne 0) { Log "푸시 실패"; exit 1 }
    Log "커밋·푸시 완료"
} else {
    Log "변경 없음"
}
Log "=== 완료 ==="
