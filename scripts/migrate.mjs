// 일회성 이관 스크립트: 기존 구글 시트 CSV 내보내기 → data/quarantine-<연도>.json
// 사용법: node scripts/migrate.mjs scripts/_sheet_export.csv
import fs from 'node:fs';
import { mergeIntoYear, updateManifest } from './store.mjs';

const file = process.argv[2];
if (!file) { console.error('사용법: node scripts/migrate.mjs <csv파일>'); process.exit(1); }

// 따옴표로 감싼 필드를 처리하는 CSV 한 줄 파서
function parseCsvLine(line) {
  const fields = [];
  let cur = '', inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (inQuotes) {
      if (c === '"' && line[i + 1] === '"') { cur += '"'; i++; }
      else if (c === '"') inQuotes = false;
      else cur += c;
    } else {
      if (c === '"') inQuotes = true;
      else if (c === ',') { fields.push(cur); cur = ''; }
      else cur += c;
    }
  }
  fields.push(cur);
  return fields;
}

const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/).filter(l => l.trim() !== '');
const byYear = new Map();
const stats = { total: 0, bad: 0 };
const 품명종류 = new Map();

for (const line of lines.slice(1)) {
  const f = parseCsvLine(line);
  const [품명, 구분, 부위, 국가, 검역량, 연도, 월] = f;
  if (!품명 || !연도 || !월) { stats.bad++; continue; }
  const kg = Math.round(Number(String(검역량).replace(/,/g, ''))) || 0;
  const year = Number(연도), month = Number(월);
  if (!year || !month) { stats.bad++; continue; }

  if (!byYear.has(year)) byYear.set(year, []);
  byYear.get(year).push([품명, 구분 || '-', 부위 || '전체', 국가, kg, month]);
  품명종류.set(품명, (품명종류.get(품명) ?? 0) + 1);
  stats.total++;
}

let added = 0, skipped = 0;
for (const [year, records] of [...byYear.entries()].sort((a, b) => a[0] - b[0])) {
  const r = mergeIntoYear(year, records);
  added += r.added; skipped += r.skipped;
  console.log(`${year}년: ${r.added}행 저장${r.skipped ? ` (중복 ${r.skipped}행 제외)` : ''}`);
}
updateManifest();

console.log(`\n이관 완료: 유효 ${stats.total}행 중 ${added}행 저장, 중복 ${skipped}행, 무시 ${stats.bad}행`);
console.log('품명별 행 수:', Object.fromEntries([...품명종류.entries()].sort((a, b) => b[1] - a[1])));
