// ================================================================
// 수입축산물 검역통계 — 정육 자동수집 (Google Apps Script → GitHub)
// ----------------------------------------------------------------
// 구글 서버에서 식약처 API를 호출해(해외 IP 차단을 우회) 전월 정육을 수집하고,
// GitHub 저장소의 data/quarantine-<연도>.json 을 직접 커밋한다.
// → 로컬 PC·윈도우 예약작업 없이 완전 자동. (부산물은 손대지 않음)
//
// [설정: 최초 1회]
//   1) script.google.com 에서 새 프로젝트 → 이 파일 내용 전체 붙여넣기
//   2) 프로젝트 설정 → 스크립트 속성에 GH_TOKEN 추가
//      (GitHub 파인그레인드 토큰: 이 저장소 · Contents 읽기/쓰기)
//   3) 프로젝트 설정 → 시간대: (GMT+09:00) 서울
//   4) 함수 目록에서 트리거설정 1회 실행 (권한 승인) → 매월 1일·15일 자동 수집 등록
//   5) (선택) 지금 바로 채우려면 정기수집 실행, 또는 수집월(2026, 8) 로 특정 월 수집
// ================================================================

const GH_OWNER  = 'dahye3498-collab';
const GH_REPO   = 'impfood-dashboard';
const GH_BRANCH = 'main';

const API_URL      = 'https://impfood.mfds.go.kr/ifs/CFSBB01F150/getUnionReceiptList.action';
const PROD_MAP     = { '소고기': '소정육', '돼지고기': '돼지정육', '양고기': '양', '염소고기': '염소' };
const GUBUN_ALLOW  = ['냉동', '냉장'];
const JEONGYUK     = ['소정육', '돼지정육', '양', '염소'];   // 교체 대상 (부산물은 보존)

// ---------------------------------------------------------------- 진입점
// 매월 트리거가 호출: 전월(서울 기준) 수집
function 정기수집() {
  const now = new Date();                       // 프로젝트 시간대(서울) 기준
  const d = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  수집월(d.getFullYear(), d.getMonth() + 1);
}

// 특정 월 수집 (수동/백필): 예) 수집월(2026, 8)
function 수집월(year, month) {
  const list = fetchMonth_(year, month);
  const rows = processRows_(list, month);
  Logger.log('▶ ' + year + '-' + month + ' 파싱: ' + rows.length + '행 (API ' + list.length + '행)');
  if (rows.length === 0) { Logger.log('⚠ 매핑 데이터 없음 — 중단'); return; }
  commitMonth_(year, month, rows);
}

// 기간 백필: 예) 수집기간(2026, 1, 2026, 7)
function 수집기간(fromY, fromM, toY, toM) {
  let y = fromY, m = fromM;
  while (y < toY || (y === toY && m <= toM)) {
    수집월(y, m);
    Utilities.sleep(800);
    m++; if (m > 12) { m = 1; y++; }
  }
}

// ---------------------------------------------------------------- 식약처 API
function fetchMonth_(year, month) {
  const pad = function (n) { return (n < 10 ? '0' : '') + n; };
  const lastDay = new Date(year, month, 0).getDate();
  const payload = { dma_search: {
    insttCd: '', startDate: '' + year + pad(month) + '01', endDate: '' + year + pad(month) + pad(lastDay),
    prodSsnm: '', prodSssnm: '', prodKnd: '', ntncd: '', ntncdList: []
  } };
  let lastErr;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const res = UrlFetchApp.fetch(API_URL, {
        method: 'post',
        contentType: 'application/json; charset=UTF-8',
        payload: JSON.stringify(payload),
        headers: {
          'Accept': 'application/json, text/javascript, */*; q=0.01',
          'X-Requested-With': 'XMLHttpRequest',
          'Referer': 'https://impfood.mfds.go.kr/'
        },
        muteHttpExceptions: true
      });
      const code = res.getResponseCode();
      if (code !== 200) throw new Error('HTTP ' + code);
      const json = JSON.parse(res.getContentText());
      return (json.gridList || []).filter(function (r) { return r.mnfNtnnm !== null && r.prodKnd !== '기타합계'; });
    } catch (e) {
      lastErr = e;
      Logger.log('  재시도 ' + attempt + '/2 (' + e.message + ')');
      Utilities.sleep(3000 * attempt);
    }
  }
  throw new Error(year + '-' + month + ' 수집 실패(3회): ' + (lastErr && lastErr.message));
}

// 가공 — collect.mjs processRows 와 동일 (wtCnt6=단월 검역량, 양/염소는 '전체'로 합산)
function processRows_(list, month) {
  const rows = [];
  const agg = {};
  for (let i = 0; i < list.length; i++) {
    const item = list[i];
    const 품명 = PROD_MAP[item.prodSsnm || ''];
    const 구분 = item.prodSssnm || '';
    const 국가 = item.mnfNtnnm || '';
    const kg = Math.round(parseFloat(String(item.wtCnt6 == null ? 0 : item.wtCnt6).replace(/,/g, ''))) || 0;
    if (!품명 || GUBUN_ALLOW.indexOf(구분) < 0 || !국가 || kg <= 0) continue;
    if (품명 === '양' || 품명 === '염소') {
      const key = 품명 + '|' + 구분 + '|' + 국가;
      agg[key] = (agg[key] || 0) + kg;
    } else {
      const 부위 = item.prodKnd || '-';
      if (부위 === '전체' || 부위 === '기타합계' || 부위 === '-') continue;
      rows.push([품명, 구분, 부위, 국가, kg, month]);
    }
  }
  Object.keys(agg).forEach(function (key) {
    const p = key.split('|');
    rows.push([p[0], p[1], '전체', p[2], agg[key], month]);
  });
  return rows;
}

// ---------------------------------------------------------------- 병합/저장 (store.mjs 이식)
function recordKey_(r) { return r[0] + '|' + r[1] + '|' + r[2] + '|' + r[3] + '|' + r[5]; }

function saveYearJson_(year, records) {
  const sorted = records.slice().sort(function (a, b) {
    return (a[5] - b[5]) ||
      a[0].localeCompare(b[0], 'ko') || a[1].localeCompare(b[1], 'ko') ||
      a[2].localeCompare(b[2], 'ko') || a[3].localeCompare(b[3], 'ko');
  });
  const lines = sorted.map(function (r) { return '    ' + JSON.stringify(r); });
  return '{\n  "year": ' + year + ',\n  "records": [\n' + lines.join(',\n') + '\n  ]\n}\n';
}

// 해당 월의 정육만 교체(부산물 보존) + 급감 안전장치
function mergeYear_(existing, newRecords, month) {
  const wouldRemove = existing.filter(function (r) {
    return r[5] === month && JEONGYUK.indexOf(r[0]) >= 0;
  }).length;
  if (wouldRemove >= 20 && newRecords.length < wouldRemove * 0.3) {
    throw new Error('교체 중단: ' + month + '월 정육 ' + wouldRemove + '행을 새 ' + newRecords.length +
      '행으로 교체하려 함(70%+ 감소 — API 이상 의심). 중단.');
  }
  const kept = existing.filter(function (r) {
    return !(r[5] === month && JEONGYUK.indexOf(r[0]) >= 0);
  });
  const keys = {};
  kept.forEach(function (r) { keys[recordKey_(r)] = 1; });
  const added = [];
  newRecords.forEach(function (r) {
    const k = recordKey_(r);
    if (keys[k]) return;
    keys[k] = 1; added.push(r);
  });
  return kept.concat(added);
}

// ---------------------------------------------------------------- GitHub 커밋
function commitMonth_(year, month, newRecords) {
  const yearPath = 'data/quarantine-' + year + '.json';
  const cur = ghGetFile_(yearPath);
  const existing = cur ? JSON.parse(cur.content).records : [];
  const merged = mergeYear_(existing, newRecords, month);
  const yearJson = saveYearJson_(year, merged);

  const files = [{ path: yearPath, content: yearJson }];

  // manifest 갱신 (연도 목록 + 갱신일시)
  const man = ghGetFile_('data/manifest.json');
  if (man) {
    const m = JSON.parse(man.content);
    m.updatedAt = new Date().toISOString();
    if (m.years.indexOf(year) < 0) { m.years.push(year); m.years.sort(function (a, b) { return a - b; }); }
    files.push({ path: 'data/manifest.json', content: JSON.stringify(m, null, 2) + '\n' });
  }

  const msg = '데이터 수집: ' + Utilities.formatDate(new Date(), 'Asia/Seoul', 'yyyy-MM-dd') +
    ' (GAS, ' + year + '-' + (month < 10 ? '0' : '') + month + ')';
  const sha = ghCommitFiles_(files, msg);
  Logger.log('✅ 커밋 완료: ' + sha.slice(0, 7) + ' — ' + year + '-' + month + ' 정육 ' + newRecords.length + '행');
}

function ghToken_() {
  const t = PropertiesService.getScriptProperties().getProperty('GH_TOKEN');
  if (!t) throw new Error('스크립트 속성 GH_TOKEN 이 없습니다. 설정에서 추가하세요.');
  return t;
}
function ghHeaders_() {
  return { 'Authorization': 'Bearer ' + ghToken_(), 'Accept': 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' };
}
function ghApi_(method, path, body) {
  const opt = { method: method, headers: ghHeaders_(), muteHttpExceptions: true };
  if (body) { opt.contentType = 'application/json'; opt.payload = JSON.stringify(body); }
  const res = UrlFetchApp.fetch('https://api.github.com' + path, opt);
  const code = res.getResponseCode();
  const txt = res.getContentText();
  if (code < 200 || code >= 300) throw new Error('GitHub ' + method + ' ' + path + ': ' + code + ' ' + txt);
  return txt ? JSON.parse(txt) : {};
}
function ghGetFile_(path) {
  const res = UrlFetchApp.fetch('https://api.github.com/repos/' + GH_OWNER + '/' + GH_REPO + '/contents/' +
    path + '?ref=' + GH_BRANCH, { headers: ghHeaders_(), muteHttpExceptions: true });
  if (res.getResponseCode() === 404) return null;
  if (res.getResponseCode() !== 200) throw new Error('GitHub GET ' + path + ': ' + res.getResponseCode() + ' ' + res.getContentText());
  const j = JSON.parse(res.getContentText());
  const content = Utilities.newBlob(Utilities.base64Decode(j.content)).getDataAsString('UTF-8');
  return { sha: j.sha, content: content };
}
// 여러 파일을 한 커밋으로 (Git Data API)
function ghCommitFiles_(files, message) {
  const base = 'https://api.github.com/repos/' + GH_OWNER + '/' + GH_REPO;
  const ref = ghApi_('get', '/repos/' + GH_OWNER + '/' + GH_REPO + '/git/ref/heads/' + GH_BRANCH);
  const latest = ref.object.sha;
  const commit = ghApi_('get', '/repos/' + GH_OWNER + '/' + GH_REPO + '/git/commits/' + latest);
  const tree = files.map(function (f) {
    const blob = ghApi_('post', '/repos/' + GH_OWNER + '/' + GH_REPO + '/git/blobs',
      { content: Utilities.base64Encode(f.content, Utilities.Charset.UTF_8), encoding: 'base64' });
    return { path: f.path, mode: '100644', type: 'blob', sha: blob.sha };
  });
  const newTree = ghApi_('post', '/repos/' + GH_OWNER + '/' + GH_REPO + '/git/trees',
    { base_tree: commit.tree.sha, tree: tree });
  const newCommit = ghApi_('post', '/repos/' + GH_OWNER + '/' + GH_REPO + '/git/commits',
    { message: message, tree: newTree.sha, parents: [latest] });
  ghApi_('patch', '/repos/' + GH_OWNER + '/' + GH_REPO + '/git/refs/heads/' + GH_BRANCH, { sha: newCommit.sha });
  return newCommit.sha;
}

// ---------------------------------------------------------------- 트리거 (최초 1회)
function 트리거설정() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === '정기수집') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('정기수집').timeBased().onMonthDay(1).atHour(10).create();
  ScriptApp.newTrigger('정기수집').timeBased().onMonthDay(15).atHour(10).create();
  Logger.log('✅ 트리거 등록: 매월 1일·15일 10시 (전월 수집)');
}
