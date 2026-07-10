# 수입축산물 검역통계 대시보드

식약처 수입식품정보(impfood.mfds.go.kr)에서 수입 축산물 검역 데이터를 매월 자동 수집해
GitHub Pages 정적 대시보드로 보여줍니다. 기존 Google Apps Script + 구글시트 시스템을
대체하며, 시트에 쌓여 있던 2016년~ 이력을 전부 이관했습니다.

## 구조

```
data/quarantine-<연도>.json   연도별 데이터 (레코드: [품명, 구분, 부위, 국가, 검역량kg, 월])
data/manifest.json            연도 목록·갱신일시 (수집기가 자동 관리)
data/fta.json                 FTA 할당관세 — 수동 관리 (GitHub에서 직접 수정)
index.html                    대시보드 (정적 페이지, 빌드 불필요)
scripts/collect.mjs           수집기
scripts/migrate.mjs           구글시트 CSV 이관용 (일회성, 완료됨)
scripts/serve.mjs             로컬 미리보기 서버
.github/workflows/collect.yml 자동 수집 워크플로
```

## 자동 수집

- **매월 1일 10:00 KST** — 전월 데이터 수집
- **매월 15일 10:00 KST** — 전월 재수집 (뒤늦게 등록·정정된 데이터 반영)
- 수집 실패 시 GitHub이 저장소 소유자에게 실패 메일을 보냅니다.
  Actions 탭에서 실패한 워크플로를 열어 "Re-run"을 누르면 재시도됩니다.

수동 실행: GitHub 저장소 → Actions → "검역데이터 수집" → Run workflow.
기간(YYYY-MM)을 지정하면 백필, `replace`를 켜면 그 기간을 지우고 재수집합니다.

로컬 실행:

```
node scripts/collect.mjs                          # 전월 수집
node scripts/collect.mjs --from 2024-01 --to 2024-12   # 기간 백필
node scripts/collect.mjs --from 2025-03 --replace # 지우고 재수집
```

## 수집 규칙 (기존 GAS와 동일)

- 소고기→소정육, 돼지고기→돼지정육: 냉동·냉장만, 부위별 저장
- 양고기→양, 염소고기→염소: 냉동·냉장만, 부위 '전체'로 합산
- 중복 키: 품명+구분+부위+국가+월 (구분 포함 — 기존 GAS의 냉동/냉장 누락 버그 수정)

### ⚠ API 컬럼 주의

`wtCnt6`이 조회기간 내 검역량이고 `wtCnt7`은 **연초부터의 누계**입니다 (wtCnt7 =
wtCnt2 + wtCnt6). 1월에는 둘이 같아서 혼동하기 쉽습니다. 기존 GAS 코드 사본에
wtCnt7을 쓰는 버전이 있었는데, 그대로 돌리면 2월부터 데이터가 누계로 오염됩니다.

## 수동 데이터

- **소부산물·돼지부산물**: 이 API에 없는 데이터라 자동 수집이 불가합니다 (기존에도
  별도 출처에서 수동 파서로 입력). 수집기의 `--replace`는 부산물 데이터를 건드리지
  않도록 보호되어 있습니다.
- **FTA 할당관세**: `data/fta.json`을 GitHub에서 직접 수정하면 대시보드에 반영됩니다.

## 로컬 미리보기

```
node scripts/serve.mjs        # http://localhost:8123
```
