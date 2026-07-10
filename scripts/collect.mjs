// 식약처 수입식품정보(impfood.mfds.go.kr)에서 월별 검역 데이터를 수집한다.
//
// 사용법:
//   node scripts/collect.mjs                          # 전월(KST 기준) 수집
//   node scripts/collect.mjs --from 2024-01           # 특정 월 수집
//   node scripts/collect.mjs --from 2024-01 --to 2024-12   # 기간 백필
//   node scripts/collect.mjs --from 2025-03 --replace # 해당 월을 지우고 재수집
//
// 수집 규칙 (기존 GAS 스크립트와 동일):
//   - 소고기/돼지고기: 냉동·냉장만, 부위별로 저장
//   - 양고기/염소고기: 냉동·냉장만, 부위 구분 없이 '전체'로 합산
import { mergeIntoYear, updateManifest } from './store.mjs';

const API_URL = 'https://impfood.mfds.go.kr/ifs/CFSBB01F150/getUnionReceiptList.action';
const PROD_MAP = { '소고기': '소정육', '돼지고기': '돼지정육', '양고기': '양', '염소고기': '염소' };
const GUBUN_ALLOW = new Set(['냉동', '냉장']);

// --- 인자 파싱 -------------------------------------------------------------
function parseArgs(argv) {
  const args = { replace: false };
  for (let i = 2; i < argv.length; i++) {
    if (argv[i] === '--from') args.from = argv[++i];
    else if (argv[i] === '--to') args.to = argv[++i];
    else if (argv[i] === '--replace') args.replace = true;
    else throw new Error(`알 수 없는 인자: ${argv[i]}`);
  }
  return args;
}

function parseYm(s) {
  const m = /^(\d{4})-(\d{1,2})$/.exec(s);
  if (!m) throw new Error(`날짜 형식이 잘못됨 (YYYY-MM 필요): ${s}`);
  const year = Number(m[1]), month = Number(m[2]);
  if (month < 1 || month > 12) throw new Error(`월은 1~12 사이여야 함: ${s}`);
  if (year < 2000 || year > 2100) throw new Error(`연도가 범위를 벗어남: ${s}`);
  return { year, month };
}

// KST 기준 전월
function previousMonthKST() {
  const kst = new Date(Date.now() + 9 * 3600 * 1000);
  let year = kst.getUTCFullYear();
  let month = kst.getUTCMonth(); // 0-based → 이대로 쓰면 전월의 1-based 값
  if (month === 0) { year -= 1; month = 12; }
  return { year, month };
}

function* monthRange(from, to) {
  let { year, month } = from;
  while (year < to.year || (year === to.year && month <= to.month)) {
    yield { year, month };
    month++;
    if (month > 12) { month = 1; year++; }
  }
}

// --- API 호출 ---------------------------------------------------------------
async function fetchMonth(year, month, attempt = 1) {
  const pad = n => String(n).padStart(2, '0');
  const lastDay = new Date(year, month, 0).getDate();
  const payload = {
    dma_search: {
      insttCd: '',
      startDate: `${year}${pad(month)}01`,
      endDate: `${year}${pad(month)}${lastDay}`,
      prodSsnm: '', prodSssnm: '', prodKnd: '', ntncd: '', ntncdList: [],
    },
  };
  try {
    const res = await fetch(API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json; charset=UTF-8',
        'Accept': 'application/json, text/javascript, */*; q=0.01',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36',
        'X-Requested-With': 'XMLHttpRequest',
        'Referer': 'https://impfood.mfds.go.kr/',
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(60_000),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = await res.json();
    return (json.gridList ?? []).filter(r => r.mnfNtnnm !== null && r.prodKnd !== '기타합계');
  } catch (err) {
    if (attempt >= 3) throw new Error(`${year}-${month} 수집 실패 (3회 시도): ${err.message}`);
    console.log(`  재시도 ${attempt}/2 (${err.message})`);
    await new Promise(r => setTimeout(r, 3000 * attempt));
    return fetchMonth(year, month, attempt + 1);
  }
}

// --- 가공 --------------------------------------------------------------------
function processRows(list, month) {
  const rows = [];
  const agg = new Map(); // 양/염소 합산: "품명|구분|국가" → kg

  for (const item of list) {
    const 품명 = PROD_MAP[item.prodSsnm ?? ''];
    const 구분 = item.prodSssnm ?? '';
    const 국가 = item.mnfNtnnm ?? '';
    // wtCnt6 = 조회기간 내 검역량. (wtCnt7은 연초부터의 누계라 쓰면 안 됨 —
    //  1월에는 둘이 같아서 혼동하기 쉽다. wtCnt7 = wtCnt2(기간 이전 누계) + wtCnt6)
    const kg = Math.round(parseFloat(String(item.wtCnt6 ?? 0).replace(/,/g, ''))) || 0;

    if (!품명 || !GUBUN_ALLOW.has(구분) || !국가 || kg <= 0) continue;

    if (품명 === '양' || 품명 === '염소') {
      const key = `${품명}|${구분}|${국가}`;
      agg.set(key, (agg.get(key) ?? 0) + kg);
    } else {
      const 부위 = item.prodKnd ?? '-';
      if (부위 === '전체' || 부위 === '기타합계' || 부위 === '-') continue;
      rows.push([품명, 구분, 부위, 국가, kg, month]);
    }
  }

  for (const [key, kg] of agg) {
    const [품명, 구분, 국가] = key.split('|');
    rows.push([품명, 구분, '전체', 국가, kg, month]);
  }
  return rows;
}

// --- 실행 --------------------------------------------------------------------
const args = parseArgs(process.argv);
const from = args.from ? parseYm(args.from) : previousMonthKST();
const to = args.to ? parseYm(args.to) : from;

let totalAdded = 0;
for (const { year, month } of monthRange(from, to)) {
  console.log(`▶ ${year}년 ${month}월 수집 중...`);
  const list = await fetchMonth(year, month);
  const rows = processRows(list, month);
  if (rows.length === 0) {
    console.log(`  ⚠ 매핑되는 데이터 없음 (API 응답 ${list.length}행)`);
    continue;
  }
  const { added, skipped } = mergeIntoYear(year, rows, {
    replaceMonths: args.replace ? [month] : [],
    replaceProducts: Object.values(PROD_MAP), // 부산물 등 수동 데이터는 건드리지 않음
  });
  totalAdded += added;
  console.log(`  ✅ ${added}행 추가${skipped > 0 ? `, ${skipped}행 중복 제외` : ''}`);
  await new Promise(r => setTimeout(r, 500));
}

if (totalAdded > 0) updateManifest();
console.log(`완료: 총 ${totalAdded}행 추가`);
