/* 로컬 서버에 요청을 보내 기록·가리기·합치기·관리 API를 확인
 *   cd server && npx wrangler dev --var ADMIN_KEY:test-key-123   (다른 창)
 *   node test/api.test.mjs
 */
import assert from 'assert';

const BASE = process.env.BASE || 'http://127.0.0.1:8787';
const KEY = process.env.ADMIN_KEY || 'test-key-123';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let n = 0;
const ip = () => '10.0.' + Math.floor(Math.random() * 250) + '.' + (++n % 250);
const post = (p, body, h = {}) => fetch(BASE + p, { method: 'POST', headers: { 'content-type': 'application/json', 'CF-Connecting-IP': ip(), ...h }, body: JSON.stringify(body) });
const admin = (p, o = {}) => fetch(BASE + p, { ...o, headers: { 'x-admin-key': KEY } });
const sid = 'test' + Date.now().toString(36);
let pass = 0;
const ok = (c, m) => { assert.ok(c, m); pass++; console.log('  ✓', m); };

const form = {
  mode: 'steps', name: '테스트 견적 보고 ' + sid,
  steps: ['견적을 딜러별로 묶는다', '담당자 hong@example.com 에게 확인', '연락처 010-1234-5678 로 문자', '계좌 110-123-456789 확인'],
  output: '표 1개', role: '분석 담당자', tone: '정중한 업무체', rules: '=SUM(A1) 같은 건 없음',
  input: '이 칸은 보내도 저장 안 됨',
};

// 1. 기록 남기기
let r = await post('/api/log', { sid, kind: 'tpl', promptLen: 500, form });
let j = await r.json();
ok(r.status === 200 && j.id, '기록이 남음');
const id = j.id;

// 2. 같은 사람이 같은 내용을 AI로 다시 만들면 한 건으로 합쳐짐
r = await post('/api/log', { sid, kind: 'ai', promptLen: 900, form });
j = await r.json();
ok(j.id === id && j.merged, '같은 내용은 한 건으로 합침');

// 3. 복사·저장 표시 (다른 사람 sid로는 안 됨)
ok((await (await post(`/api/log/${id}/copy`, { sid: 'someoneelse1' })).json()).ok === false, '남의 기록에는 복사 표시 못 함');
ok((await (await post(`/api/log/${id}/copy`, { sid })).json()).ok === true, '복사 표시');
ok((await (await post(`/api/log/${id}/save`, { sid })).json()).ok === true, '저장 표시');

// 4. 빈 내용·이상한 몸·너무 큰 몸
ok((await post('/api/log', { sid, form: { mode: 'steps', steps: [] } })).status === 400, '빈 내용 거절');
ok((await fetch(BASE + '/api/log', { method: 'POST', headers: { 'CF-Connecting-IP': ip() }, body: '{oops' })).status === 400, '깨진 JSON 거절');
ok((await post('/api/log', { sid, form: { ...form, free: 'x'.repeat(30000) } })).status === 400, '너무 큰 요청 거절');

// 5. 같은 곳에서 너무 빨리 연달아 보내면 거절
const same = { 'CF-Connecting-IP': '10.9.9.9' };
await post('/api/log', { sid: sid + 'b', kind: 'tpl', form: { ...form, name: 'gap1' } }, same);
ok((await post('/api/log', { sid: sid + 'b', kind: 'tpl', form: { ...form, name: 'gap2' } }, same)).status === 429, '연달아 보내기 제한');

// 6. 예시 그대로 누른 기록
await post('/api/log', { sid: sid + 'c', kind: 'tpl', example: true, form: { ...form, name: '예시 ' + sid } });

// 7. 관리 API
ok((await fetch(BASE + '/api/admin/stats')).status === 401, '비밀번호 없으면 막힘');
ok((await fetch(BASE + '/api/admin/stats', { headers: { 'x-admin-key': 'wrong-key-12' } })).status === 401, '틀린 비밀번호 막힘');
const list = await (await admin('/api/admin/logs?q=' + encodeURIComponent(sid))).json();
const it = list.items.find((x) => x.id === id);
ok(it, '목록에서 찾기');
ok(it.kind === 'both' && it.copied === 1 && it.saved === 1 && it.prompt_len === 900, '합친 기록 상태(틀+AI·복사·저장)');
const all = JSON.stringify(it);
ok(!all.includes('hong@example.com') && all.includes('[이메일]'), '이메일 가림');
ok(!all.includes('1234-5678') && all.includes('[전화번호]'), '전화번호 가림');
ok(!all.includes('456789') && all.includes('[번호]'), '계좌번호 가림');
ok(!all.includes('저장 안 됨') && !('input' in it), "'AI에게 줄 자료' 칸은 저장 안 함");
ok(!list.items.some((x) => x.name.startsWith('예시 ')), '예시 기록은 기본 목록에서 빠짐');
const withEx = await (await admin('/api/admin/logs?examples=1&q=' + encodeURIComponent(sid))).json();
ok(withEx.items.some((x) => x.name.startsWith('예시 ')), '예시 포함하면 보임');

const st = await (await admin('/api/admin/stats')).json();
ok(st.total.n >= 1 && st.days.length >= 1 && st.examples >= 1, '통계 나옴');
ok(st.words.some((w) => w.k === '견적'), '낱말 통계에 "견적" (조사 뗌)');

const raw = new Uint8Array(await (await admin('/api/admin/export.csv')).arrayBuffer());
const csv = new TextDecoder().decode(raw);
ok(raw[0] === 0xef && raw[1] === 0xbb && raw[2] === 0xbf && csv.includes('업무 이름') && csv.includes(sid), 'CSV 받기 (엑셀용 BOM)');
ok(csv.includes("'=SUM(A1)") || !csv.includes(',=SUM'), 'CSV 수식 주입 막힘');

// 8. 지우기
ok((await (await admin('/api/admin/logs/' + id, { method: 'DELETE' })).json()).ok, '지우기');
const after = await (await admin('/api/admin/logs?q=' + encodeURIComponent(sid))).json();
ok(!after.items.some((x) => x.id === id), '지운 기록 사라짐');

ok((await fetch(BASE + '/admin')).headers.get('content-type').includes('text/html'), '관리 페이지 열림');
console.log(`\n${pass}개 모두 통과`);
