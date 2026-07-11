// 데이터 저장/불러오기 공통 모듈
// data/quarantine-<연도>.json 파일에 연도별로 저장한다.
// 레코드: [품명, 구분, 부위, 국가, 검역량(kg), 월]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const DATA_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'data');

export const COLUMNS = ['품명', '구분', '부위', '국가', '검역량', '월'];

function yearFile(year) {
  return path.join(DATA_DIR, `quarantine-${year}.json`);
}

export function loadYear(year) {
  const file = yearFile(year);
  if (!fs.existsSync(file)) return [];
  return JSON.parse(fs.readFileSync(file, 'utf8')).records;
}

// 중복 판별 키: 품명|구분|부위|국가|월  (구분 포함 — 냉동/냉장을 별개로 취급)
export function recordKey(r) {
  return `${r[0]}|${r[1]}|${r[2]}|${r[3]}|${r[5]}`;
}

export function saveYear(year, records) {
  const sorted = [...records].sort((a, b) =>
    (a[5] - b[5]) ||
    a[0].localeCompare(b[0], 'ko') ||
    a[1].localeCompare(b[1], 'ko') ||
    a[2].localeCompare(b[2], 'ko') ||
    a[3].localeCompare(b[3], 'ko')
  );
  const lines = sorted.map(r => '    ' + JSON.stringify(r));
  const json = `{\n  "year": ${year},\n  "records": [\n${lines.join(',\n')}\n  ]\n}\n`;
  fs.writeFileSync(yearFile(year), json, 'utf8');
}

// 신규 레코드를 연도 파일에 병합. 이미 있는 키는 건너뛴다.
// replaceMonths: 해당 월의 기존 데이터를 지우고 새로 넣을 때 (재수집용)
// replaceProducts: 교체 대상 품명 — 지정하면 그 품명만 지운다.
//   (API가 관리하지 않는 부산물 등 수동 입력 데이터를 보호하기 위함)
export function mergeIntoYear(year, newRecords, { replaceMonths = [], replaceProducts = null } = {}) {
  let existing = loadYear(year);
  if (replaceMonths.length > 0) {
    // 안전장치: 교체하려는 새 데이터가 기존 대비 30% 미만이면 API 이상 응답일
    // 가능성이 높으므로 중단한다 (정상적인 정정으로 조합이 이렇게 급감하지는 않음)
    const wouldRemove = existing.filter(r =>
      replaceMonths.includes(r[5]) && (!replaceProducts || replaceProducts.includes(r[0]))
    ).length;
    if (wouldRemove >= 20 && newRecords.length < wouldRemove * 0.3) {
      throw new Error(
        `교체 중단: ${year}년 ${replaceMonths.join(',')}월 기존 ${wouldRemove}행을 새 데이터 ${newRecords.length}행으로 ` +
        `바꾸려 함 (70% 이상 감소 — API 이상 응답 의심). 정말 맞다면 해당 월 데이터를 수동 확인 후 진행하세요.`
      );
    }
    existing = existing.filter(r =>
      !replaceMonths.includes(r[5]) ||
      (replaceProducts && !replaceProducts.includes(r[0]))
    );
  }
  const keys = new Set(existing.map(recordKey));
  // 기존 데이터와의 중복 + 신규 배치 안에서의 중복을 모두 걸러낸다
  const added = newRecords.filter(r => {
    const k = recordKey(r);
    if (keys.has(k)) return false;
    keys.add(k);
    return true;
  });
  if (added.length > 0 || replaceMonths.length > 0) {
    saveYear(year, existing.concat(added));
  }
  return { added: added.length, skipped: newRecords.length - added.length };
}

export function updateManifest() {
  const years = fs.readdirSync(DATA_DIR)
    .map(f => f.match(/^quarantine-(\d{4})\.json$/))
    .filter(Boolean)
    .map(m => Number(m[1]))
    .sort((a, b) => a - b);
  const manifest = { updatedAt: new Date().toISOString(), years, columns: COLUMNS };
  fs.writeFileSync(path.join(DATA_DIR, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n', 'utf8');
}
