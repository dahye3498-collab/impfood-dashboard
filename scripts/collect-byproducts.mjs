// 소·돼지 부산물 수집기 (수동) — QIA(eminwon) 단월 엑셀을 받아 해당 월을 교체한다.
//
// 부산물은 식약처 API에 없어 자동수집 불가. 매달 QIA에서 단월로 내려받아 이 스크립트로 반영한다.
//   1) https://eminwon.qia.go.kr/statistics/statistics_No2.do?action=search
//      통계분류=수입축산물, 품목=육류, 검사기간=해당월~해당월(반드시 단월!), 국가=전체 → 엑셀 다운로드
//   2) node scripts/collect-byproducts.mjs <내려받은.xls> <연도> <월>
//      (미리보기만: 끝에 --dry 를 붙이면 저장하지 않고 합계만 출력)
//   3) git add data && git commit && git push
//
// ⚠ 검사기간을 "해당월~해당월" 단월로 두지 않으면 누계(YTD)가 그 달 값으로 들어가 오염된다.
import fs from 'node:fs';
import { mergeIntoYear, updateManifest } from './store.mjs';

// QIA 품명 → 레포 부위 매핑 (kg 단위까지 검증됨). 희소 부위(우족·소간·소심장 등)는 제외.
const BEEF = {
  '소횡격막': '안창토시', '소건': '우건', '소꼬리': '꼬리',
  '소머리고기(볼살)': '볼살', '소위': '깐양홍창', '소창자': '곱창대창', '쇠고기 기타': '뼈',
};
const PORK = {
  '돼지횡격막': '갈매기', '돼지머리': '돼지머리', '돼지족': '장족단족',
  '돼지고기 기타': '목뼈등뼈', '돼지장': '곱창막창',
};

// --- QIA 엑셀(실제로는 HTML 표) 파서 : rowspan 복원 ---------------------------
function parseQiaTable(html) {
  const rows = [];
  const trRe = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
  const tdRe = /<t[dh]\b([^>]*)>([\s\S]*?)<\/t[dh]>/gi;
  let tr;
  while ((tr = trRe.exec(html))) {
    const cells = [];
    let td;
    tdRe.lastIndex = 0;
    while ((td = tdRe.exec(tr[1]))) {
      const m = /rowspan\s*=\s*["']?(\d+)/i.exec(td[1] || '');
      const span = m ? parseInt(m[1], 10) : 1;
      const text = td[2].replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').trim();
      cells.push([text, span]);
    }
    if (cells.length) rows.push(cells);
  }
  // rowspan carry 로 그리드 복원
  const grid = [];
  const carry = {};
  for (const cells of rows) {
    const out = [];
    let k = 0, col = 0;
    const max = cells.length + Object.keys(carry).length + 5;
    while (col < max) {
      if (carry[col] && carry[col][1] > 0) {
        out.push(carry[col][0]); carry[col] = [carry[col][0], carry[col][1] - 1]; col++; continue;
      }
      if (k < cells.length) {
        const [text, span] = cells[k++];
        out.push(text);
        if (span > 1) carry[col] = [text, span - 1];
        col++;
      } else break;
    }
    grid.push(out);
  }
  return grid;
}

// --- 실행 --------------------------------------------------------------------
const [file, yearArg, monthArg, ...rest] = process.argv.slice(2);
const dry = rest.includes('--dry');
if (!file || !yearArg || !monthArg) {
  console.error('사용법: node scripts/collect-byproducts.mjs <QIA엑셀.xls> <연도> <월> [--dry]');
  process.exit(1);
}
const year = Number(yearArg), month = Number(monthArg);

const html = fs.readFileSync(file, 'utf8');
// 검사기간 검증: 단월인지 확인 (YYYYMM ~ YYYYMM 이 같아야 함)
const period = /검사기간\s*[:：]\s*(\d{6})\s*~\s*(\d{6})/.exec(html.replace(/<[^>]+>/g, ' '));
if (period) {
  const want = `${year}${String(month).padStart(2, '0')}`;
  if (period[1] !== period[2]) { console.error(`⚠ 검사기간이 단월이 아님(${period[1]}~${period[2]}) — 누계 오염 위험. 중단.`); process.exit(1); }
  if (period[1] !== want) { console.error(`⚠ 파일 검사기간(${period[1]})과 지정한 ${want}가 다름. 중단.`); process.exit(1); }
}

const grid = parseQiaTable(html);
const rows = [];
for (const g of grid) {
  if (g[0] !== '육류') continue;
  const [, 품명, 국가, , 중량] = g;
  if (!품명 || !국가 || String(국가).includes('계')) continue; // 품명계/품목계/총계 제외
  const kg = Math.round(parseFloat(String(중량 ?? '').replace(/,/g, ''))) || 0;
  if (BEEF[품명]) rows.push(['소부산물', '부산물', BEEF[품명], 국가, kg, month]);
  else if (PORK[품명]) rows.push(['돼지부산물', '부산물', PORK[품명], 국가, kg, month]);
}

const soT = rows.filter(r => r[0] === '소부산물').reduce((s, r) => s + r[4], 0);
const doT = rows.filter(r => r[0] === '돼지부산물').reduce((s, r) => s + r[4], 0);
console.log(`파싱: ${rows.length}행 — 소부산물 ${(soT / 1000).toFixed(0)}t, 돼지부산물 ${(doT / 1000).toFixed(0)}t`);

if (dry) { console.log('(--dry) 저장하지 않음.'); process.exit(0); }

const res = mergeIntoYear(year, rows, { replaceMonths: [month], replaceProducts: ['소부산물', '돼지부산물'] });
updateManifest();
console.log(`${year}-${String(month).padStart(2, '0')} 부산물 교체 완료: ${res.added}행 반영 (기존 삭제 후 대체).`);
console.log('→ git add data && git commit -m "부산물 수집: ..." && git push');
