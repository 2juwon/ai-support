/* AI로 다듬기(/api/refine) 시험 — 진짜 Claude 대신 가짜 서버를 띄워 확인
 *   cd server
 *   node test/refine.test.mjs --mock        (다른 창: 가짜 Claude 서버, 8799번)
 *   npx wrangler dev --var ADMIN_KEY:test-key-123 --var ANTHROPIC_API_KEY:fake-key \
 *     --var ANTHROPIC_URL:http://127.0.0.1:8799/v1/messages --var AI_PER_PERSON:3 --var AI_GAP_MS:1
 *   node test/refine.test.mjs
 */
import assert from 'assert';
import http from 'http';

if (process.argv.includes('--mock')) {
  // 메모에 "실패"가 있으면 500, "자르기"가 있으면 max_tokens로 끝냄
  http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      const b = JSON.parse(body);
      const memo = b.messages[0].content;
      if (req.headers['x-api-key'] !== 'fake-key') { res.writeHead(401); return res.end('{}'); }
      if (!b.stream && b.system.includes('업무 흐름을 정리')) {      // 프롬프트 → 워크플로우
        res.writeHead(200, { 'content-type': 'application/json' });
        const text = memo.includes('못읽음') ? '죄송해요, 모르겠어요' : '설명입니다\n{"name":"견적 정리","steps":["견적을 모은다","표로 만든다"],"input":"견적 목록","output":"표","role":"분석가","tone":"간결","rules":["숫자 지어내지 않기","추정 표시"]}';
        return res.end(JSON.stringify({ content: [{ type: 'text', text }], usage: { input_tokens: 500, output_tokens: 100 } }));
      }
      if (!b.stream || !b.system.includes('업무 프롬프트')) { res.writeHead(401); return res.end('{}'); }
      if (memo.includes('실패')) { res.writeHead(500); return res.end('{"type":"error"}'); }
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      const ev = (type, o) => res.write(`event: ${type}\ndata: ${JSON.stringify({ type, ...o })}\n\n`);
      ev('message_start', { message: { usage: { input_tokens: 1200 } } });
      ev('content_block_start', { index: 0, content_block: { type: 'text', text: '' } });
      const parts = ['# 역할\n', '당신은 ', '분석 담당자입니다.\n\n', '# 메모 길이\n' + memo.length];
      let i = 0;
      const t = setInterval(() => {
        if (i < parts.length) return ev('content_block_delta', { index: 0, delta: { type: 'text_delta', text: parts[i++] } });
        clearInterval(t);
        ev('content_block_stop', { index: 0 });
        ev('message_delta', { delta: { stop_reason: memo.includes('자르기') ? 'max_tokens' : 'end_turn' }, usage: { output_tokens: 800 } });
        ev('message_stop', {});
        res.end();
      }, 30);
    });
  }).listen(8799, () => console.log('가짜 Claude 서버 8799'));
} else {
  const BASE = process.env.BASE || 'http://127.0.0.1:8787';
  const KEY = process.env.ADMIN_KEY || 'test-key-123';
  let pass = 0;
  const ok = (c, m) => { assert.ok(c, m); pass++; console.log('  ✓', m); };
  const sid = 'rf' + Date.now().toString(36);
  const form = (name, extra = {}) => ({ mode: 'steps', name, steps: ['견적을 모은다', '표로 정리한다'], input: '견적 엑셀', output: '표', role: '분석 담당자', tone: '정중한 업무체', rules: '', ...extra });
  const call = (body, ip, h = {}) => fetch(BASE + '/api/refine', { method: 'POST', headers: { 'content-type': 'application/json', 'CF-Connecting-IP': ip, ...h }, body: JSON.stringify(body) });
  async function read(r) {
    const lines = (await r.text()).trim().split('\n').map((l) => JSON.parse(l));
    return { lines, text: lines.filter((l) => l.t).map((l) => l.t).join(''), end: lines.find((l) => l.done || l.error), left: lines.find((l) => 'left' in l)?.left };
  }

  // 1. 정상: 글이 조각조각 오고 끝 표시
  let r = await call({ sid, form: form('견적 보고') }, '10.1.0.1');
  ok(r.status === 200 && r.headers.get('content-type').includes('ndjson'), '흘려보내기 응답');
  ok(r.headers.get('access-control-allow-origin') === '*', 'CORS 헤더');
  let o = await read(r);
  ok(o.text.startsWith('# 역할\n당신은 분석 담당자입니다.'), '글을 이어 붙이면 프롬프트가 됨');
  ok(o.end.done && !o.end.truncated, '끝 표시');
  ok(o.left === 2, '남은 횟수 알려 줌 (3번 중 1번 씀)');

  // 2. 잘림
  o = await read(await call({ sid, form: form('자르기 시험') }, '10.1.0.1'));
  ok(o.end.done && o.end.truncated, '길어서 잘리면 truncated');

  // 3. Claude 쪽 실패는 502 + 횟수에서 빠짐
  r = await call({ sid, form: form('실패 시험') }, '10.1.0.1');
  const j = await r.json();
  ok(r.status === 502 && j.code === 'busy' && j.error, 'Claude 실패는 502로 알림');

  // 4. 한 사람 3번 제한 (실패한 건 안 셈 → 3번째가 됨, 4번째 막힘)
  o = await read(await call({ sid, form: form('세 번째') }, '10.1.0.1'));
  ok(o.end.done && o.left === 0, '실패한 건 횟수에서 뺌');
  r = await call({ sid, form: form('네 번째') }, '10.1.0.1');
  ok(r.status === 429 && (await r.json()).code === 'person', '하루 횟수 넘으면 막힘');
  r = await call({ sid, form: form('IP만 바꿈') }, '10.1.0.99');
  ok(r.status === 429, '같은 브라우저면 IP가 달라도 막힘');
  r = await call({ sid: sid + 'x', form: form('브라우저만 바꿈') }, '10.1.0.1');
  ok(r.status === 429, '같은 IP면 브라우저가 달라도 막힘');

  // 5. 주인(관리자 비밀번호)은 제한 없음
  o = await read(await call({ sid, form: form('주인 시험') }, '10.1.0.1', { 'x-admin-key': KEY }));
  ok(o.end.done && o.left === undefined, '주인은 제한에서 빠짐');

  // 6. 빈 내용·깨진 몸
  r = await call({ sid: sid + 'e', form: { mode: 'steps', steps: ['  '] } }, '10.1.0.5');
  ok(r.status === 400 && (await r.json()).code === 'empty', '빈 내용 거절');
  r = await fetch(BASE + '/api/refine', { method: 'POST', headers: { 'CF-Connecting-IP': '10.1.0.6' }, body: '{oops' });
  ok(r.status === 400, '깨진 JSON 거절');

  // 7. 아주 긴 단계는 잘라서 보냄 (가짜 서버가 메모 길이를 돌려줌)
  o = await read(await call({ sid: sid + 'l', form: form('긴 것', { steps: Array(35).fill('가'.repeat(520)) }) }, '10.1.0.7'));
  const len = +o.text.split('\n').pop();
  ok(len > 0 && len < 30 * 520 + 500, '긴 내용은 잘라서 보냄 (' + len + '자)');

  // 7-1. 프롬프트 → 워크플로우
  r = await fetch(BASE + '/api/extract', { method: 'POST', headers: { 'content-type': 'application/json', 'CF-Connecting-IP': '10.1.0.8' }, body: JSON.stringify({ sid: sid + 'x1', prompt: '견적을 모아서 표로 정리해 줘. 숫자는 지어내지 마.' }) });
  let x = await r.json();
  ok(r.status === 200 && x.form.steps.length === 2 && x.form.tone === '간결한 보고체 (~함, ~임)' && x.form.rules === '숫자 지어내지 않기, 추정 표시' && x.left === 2, 'AI로 프롬프트를 워크플로우로 읽음 (말투 맞춤·남은 횟수)');
  r = await fetch(BASE + '/api/extract', { method: 'POST', headers: { 'content-type': 'application/json', 'CF-Connecting-IP': '10.1.0.8' }, body: JSON.stringify({ sid: sid + 'x1', prompt: '못읽음 이건 아무 순서도 없는 글이에요' }) });
  x = await r.json();
  ok(r.status === 422 && x.code === 'unreadable', '못 읽으면 422');
  r = await fetch(BASE + '/api/extract', { method: 'POST', headers: { 'content-type': 'application/json', 'CF-Connecting-IP': '10.1.0.8' }, body: JSON.stringify({ sid: sid + 'x1', prompt: '견적 정리 두 번째 요청입니다' }) });
  x = await r.json();
  ok(r.status === 200 && x.left === 1, '못 읽은 건 횟수에서 뺌');
  ok((await fetch(BASE + '/api/extract', { method: 'POST', headers: { 'content-type': 'application/json', 'CF-Connecting-IP': '10.1.0.9' }, body: '{"prompt":"짧음"}' })).status === 400, '너무 짧으면 거절');

  // 8. 관리 통계에 AI 사용량
  const st = await (await fetch(BASE + '/api/admin/stats', { headers: { 'x-admin-key': KEY } })).json();
  ok(st.ai && st.ai.hasKey && st.ai.today.calls >= 5 && st.ai.total.fails >= 1 && st.ai.today.cost > 0, '관리 통계에 AI 횟수·실패·예상 비용');
  ok((await (await fetch(BASE + '/')).json()).ai === true, '첫 화면에 AI 켜짐 표시');

  console.log(`\n${pass}개 모두 통과`);
}
