/* 업무 프롬프트 공방 — 익명 기록 서버 (Cloudflare Workers + Durable Object SQLite) */
import { Store } from './store.js';
import { ADMIN_HTML } from './admin.js';
import { memoText, refine } from './refine.js';
export { Store };

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, x-admin-key',
  'Access-Control-Max-Age': '86400',
};
const json = (obj, status = 200) => new Response(JSON.stringify(obj), {
  status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...CORS },
});
const store = (env) => env.STORE.get(env.STORE.idFromName('main'));
const ipOf = (req) => req.headers.get('CF-Connecting-IP') || 'local';

function adminOk(request, env) {
  const want = env.ADMIN_KEY || '';
  const got = request.headers.get('x-admin-key') || '';
  if (!want || got.length !== want.length) return false;
  let diff = 0;
  for (let i = 0; i < want.length; i++) diff |= want.charCodeAt(i) ^ got.charCodeAt(i);
  return diff === 0;
}

async function readJson(request, max = 20000) {
  if (+(request.headers.get('content-length') || 0) > max) throw new Error('too big');
  const t = await request.text();
  if (t.length > max) throw new Error('too big');
  return JSON.parse(t);
}

const csvCell = (v) => {
  let s = Array.isArray(v) ? v.join(' / ') : String(v ?? '');
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;          // 엑셀 수식으로 읽히지 않게
  return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
};
function toCsv(rows) {
  const cols = [['at', '시각'], ['kind', '만든 방법'], ['mode', '입력 방식'], ['name', '업무 이름'], ['steps', '작업 순서'],
    ['free', '업무 설명'], ['output', '받고 싶은 결과'], ['role', '역할'], ['tone', '말투'], ['rules', '지킬 것'],
    ['step_count', '단계 수'], ['prompt_len', '프롬프트 길이'], ['copied', '복사함'], ['saved', '저장함'], ['example', '예시 그대로'], ['sid', '익명 사용자']];
  const fmt = (t) => new Date(t + 9 * 3600e3).toISOString().slice(0, 19).replace('T', ' ');
  const lines = [cols.map((c) => c[1]).join(',')];
  for (const r of rows) lines.push(cols.map(([k]) => csvCell(k === 'at' ? fmt(r.at) : k === 'kind' ? ({ tpl: '틀', ai: 'AI', both: '둘 다' })[r.kind] : r[k])).join(','));
  return '﻿' + lines.join('\r\n');   // BOM: 엑셀에서 한글이 깨지지 않게
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
    try {
      if (url.pathname === '/') return json({ ok: true, name: 'ai-support', admin: '/admin', ai: !!env.ANTHROPIC_API_KEY });

      if (url.pathname === '/api/refine' && request.method === 'POST') {
        if (!env.ANTHROPIC_API_KEY) return json({ code: 'no_key', error: '서버에 AI 열쇠가 아직 없어서 AI 다듬기를 쓸 수 없어요.' }, 503);
        let body;
        try { body = await readJson(request, 60000); } catch (e) { return json({ code: 'bad', error: '보낸 내용을 읽지 못했어요' }, 400); }
        const memo = memoText(body.form);
        if (!memo) return json({ code: 'empty', error: '작업 순서나 업무 설명을 한 줄 이상 적어 주세요.' }, 400);
        const s = store(env);
        const st = await s.aiStart(ipOf(request), String(body.sid || ''), adminOk(request, env));
        if (st.error) return json(st, 429);
        return refine({
          env, memo, left: st.left, headers: CORS,
          onEnd: (r) => s.aiEnd(st.day, st.keys, r),
          waitUntil: (p) => ctx.waitUntil(p),
        });
      }

      if (url.pathname === '/api/log' && request.method === 'POST') {
        let body;
        try { body = await readJson(request); } catch (e) { return json({ error: '보낸 내용을 읽지 못했어요' }, 400); }
        const r = await store(env).add(body, ipOf(request));
        return json(r, r.error ? (r.error === '내용이 없어요' ? 400 : 429) : 200);
      }
      const mk = url.pathname.match(/^\/api\/log\/([a-z0-9]{10,30})\/(copy|save)$/);
      if (mk && request.method === 'POST') {
        let body = {};
        try { body = await readJson(request, 2000); } catch (e) { /* 빈 몸이어도 됨 */ }
        return json(await store(env).mark(mk[1], mk[2], String(body.sid || '')));
      }

      if (url.pathname === '/admin') {
        return new Response(ADMIN_HTML, { headers: { 'content-type': 'text/html; charset=utf-8', 'x-robots-tag': 'noindex', 'cache-control': 'no-store' } });
      }
      if (url.pathname.startsWith('/api/admin/')) {
        if (!adminOk(request, env)) return json({ error: env.ADMIN_KEY ? '비밀번호가 맞지 않아요' : '서버에 관리자 비밀번호(ADMIN_KEY)가 아직 없어요' }, 401);
        const s = store(env);
        if (url.pathname === '/api/admin/stats') return json(await s.stats());
        if (url.pathname === '/api/admin/logs') {
          const p = url.searchParams;
          return json(await s.list({ limit: +p.get('limit') || 100, offset: +p.get('offset') || 0, q: (p.get('q') || '').slice(0, 50), examples: p.get('examples') === '1' }));
        }
        if (url.pathname === '/api/admin/export.csv') {
          return new Response(toCsv(await s.exportRows()), {
            headers: { 'content-type': 'text/csv; charset=utf-8', 'content-disposition': `attachment; filename="ai-support-${new Date().toISOString().slice(0, 10)}.csv"`, 'cache-control': 'no-store' },
          });
        }
        const dm = url.pathname.match(/^\/api\/admin\/logs\/([a-z0-9]{10,30})$/);
        if (dm && request.method === 'DELETE') return json({ ok: await s.remove(dm[1]) });
      }
      return json({ error: '없는 주소예요' }, 404);
    } catch (e) {
      console.error(e);
      return json({ error: '서버 오류가 났어요' }, 500);
    }
  },
};
