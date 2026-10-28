/* 프롬프트 기록 보관함: 페이지에서 만든 업무 프롬프트의 입력 내용을 익명으로 모음 */
import { DurableObject } from 'cloudflare:workers';
import { mask } from './mask.js';

const LIM = { name: 80, step: 300, steps: 20, free: 3000, output: 300, role: 100, tone: 40, rules: 600 };
const PER_DAY = 200;        // 한 곳(IP)에서 하루에 남길 수 있는 기록 수
const GAP_MS = 1500;        // 너무 빠른 연속 요청 막기
const SAME_MS = 30 * 60e3;  // 같은 사람이 같은 내용을 30분 안에 다시 만들면 한 건으로 합침
const KEEP = 50000;         // 이보다 많으면 오래된 것부터 지움

const cut = (s, n) => Array.from(mask(s).trim()).slice(0, n).join('');
const KINDS = { tpl: 1, ai: 2 };
const kindName = (b) => (b === 3 ? 'both' : b === 2 ? 'ai' : 'tpl');

export function cleanForm(f) {
  f = f && typeof f === 'object' ? f : {};
  const mode = f.mode === 'free' ? 'free' : 'steps';
  const steps = mode === 'steps' && Array.isArray(f.steps)
    ? f.steps.map((s) => cut(s, LIM.step)).filter(Boolean).slice(0, LIM.steps) : [];
  return {
    mode,
    name: cut(f.name, LIM.name),
    steps,
    free: mode === 'free' ? cut(f.free, LIM.free) : '',
    output: cut(f.output, LIM.output),
    role: cut(f.role, LIM.role),
    tone: cut(f.tone, LIM.tone),
    rules: cut(f.rules, LIM.rules),
  };
}

async function sha(s) {
  const b = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, '0')).join('');
}
const kstDay = (t) => new Date(t + 9 * 3600e3).toISOString().slice(0, 10);

export class Store extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.sql = ctx.storage.sql;
    this.sql.exec(`CREATE TABLE IF NOT EXISTS logs(
      id TEXT PRIMARY KEY, at INTEGER NOT NULL, day TEXT NOT NULL, sid TEXT, hash TEXT,
      kinds INTEGER NOT NULL DEFAULT 0, example INTEGER NOT NULL DEFAULT 0,
      mode TEXT, name TEXT, steps TEXT, free TEXT, output TEXT, role TEXT, tone TEXT, rules TEXT,
      step_count INTEGER, prompt_len INTEGER, copied INTEGER NOT NULL DEFAULT 0, saved INTEGER NOT NULL DEFAULT 0)`);
    this.sql.exec('CREATE INDEX IF NOT EXISTS logs_at ON logs(at)');
    this.sql.exec('CREATE INDEX IF NOT EXISTS logs_sid ON logs(sid, hash)');
    this.sql.exec('CREATE TABLE IF NOT EXISTS limits(who TEXT PRIMARY KEY, day TEXT, n INTEGER, last INTEGER)');
    // AI로 다듬기: 사람(IP·브라우저)별 하루 횟수, 날짜별 호출·토큰 수 (내용은 남기지 않음)
    this.sql.exec('CREATE TABLE IF NOT EXISTS ai_limits(who TEXT PRIMARY KEY, day TEXT, n INTEGER, last INTEGER)');
    this.sql.exec(`CREATE TABLE IF NOT EXISTS ai_days(day TEXT PRIMARY KEY, calls INTEGER NOT NULL DEFAULT 0,
      fails INTEGER NOT NULL DEFAULT 0, in_tok INTEGER NOT NULL DEFAULT 0, out_tok INTEGER NOT NULL DEFAULT 0)`);
  }

  aiConf() {
    const n = (v, d) => (Number.isFinite(+v) && +v > 0 ? +v : d);
    return { daily: n(this.env.AI_DAILY, 300), perPerson: n(this.env.AI_PER_PERSON, 20), gap: n(this.env.AI_GAP_MS, 5000) };
  }

  // AI 다듬기 한 번 쓰기 전 확인 + 미리 한 번 셈. { ok, left, keys, day } 또는 { error, code }
  async aiStart(ip, sid, owner) {
    const now = Date.now(), day = kstDay(now), c = this.aiConf();
    const keys = [(await sha('ai-ip:' + ip)).slice(0, 24)];
    if (/^[a-z0-9]{8,40}$/.test(sid || '')) keys.push('s:' + sid);
    const used = this.sql.exec('SELECT calls FROM ai_days WHERE day=?', day).toArray()[0]?.calls || 0;
    let mine = 0;
    if (!owner) {
      if (used >= c.daily) return { code: 'daily', error: `오늘 모두가 쓸 수 있는 AI 다듬기 ${c.daily}번을 다 썼어요. 내일 다시 써 주세요. '틀에 맞춰 바로 만들기'는 그대로 쓸 수 있어요.` };
      for (const who of keys) {
        const r = this.sql.exec('SELECT day, n, last FROM ai_limits WHERE who=?', who).toArray()[0];
        if (!r || r.day !== day) continue;
        if (now - r.last < c.gap) return { code: 'gap', error: '조금만 있다가 다시 눌러 주세요.' };
        mine = Math.max(mine, r.n);
      }
      if (mine >= c.perPerson) return { code: 'person', error: `AI 다듬기는 하루 ${c.perPerson}번까지예요. 내일 다시 써 주세요.` };
    }
    for (const who of keys) {
      const r = this.sql.exec('SELECT day, n FROM ai_limits WHERE who=?', who).toArray()[0];
      this.sql.exec('INSERT OR REPLACE INTO ai_limits(who, day, n, last) VALUES(?,?,?,?)', who, day, (r && r.day === day ? r.n : 0) + 1, now);
    }
    this.sql.exec('INSERT INTO ai_days(day, calls) VALUES(?,1) ON CONFLICT(day) DO UPDATE SET calls=calls+1', day);
    return { ok: true, day, keys, left: owner ? null : Math.max(0, Math.min(c.perPerson - mine - 1, c.daily - used - 1)) };
  }

  // 끝난 뒤 토큰 수 기록. 글이 하나도 안 나온 실패는 횟수에서 뺌
  async aiEnd(day, keys, { gotText, inTok, outTok }) {
    this.sql.exec('UPDATE ai_days SET in_tok=in_tok+?, out_tok=out_tok+? WHERE day=?', inTok | 0, outTok | 0, day);
    if (!gotText) {
      this.sql.exec('UPDATE ai_days SET calls=MAX(0,calls-1), fails=fails+1 WHERE day=?', day);
      for (const who of keys) this.sql.exec('UPDATE ai_limits SET n=MAX(0,n-1), last=0 WHERE who=? AND day=?', who, day);
    }
    // 오래된 사람별 제한 정리
    this.sql.exec('DELETE FROM ai_limits WHERE day<?', kstDay(Date.now() - 3 * 86400e3));
  }

  aiStats() {
    const c = this.aiConf(), today = kstDay(Date.now());
    const pin = +this.env.PRICE_IN || 0.10, pout = +this.env.PRICE_OUT || 0.50;   // 백만 토큰당 달러
    const days = this.sql.exec('SELECT * FROM ai_days ORDER BY day DESC LIMIT 30').toArray().reverse();
    const all = this.sql.exec('SELECT SUM(calls) AS calls, SUM(fails) AS fails, SUM(in_tok) AS in_tok, SUM(out_tok) AS out_tok FROM ai_days').one();
    const cost = (r) => ((r.in_tok || 0) * pin + (r.out_tok || 0) * pout) / 1e6;
    const t = days.find((d) => d.day === today) || { calls: 0, fails: 0, in_tok: 0, out_tok: 0 };
    return {
      model: this.env.AI_MODEL || 'claude-haiku-5-5', hasKey: !!this.env.ANTHROPIC_API_KEY, daily: c.daily, perPerson: c.perPerson,
      today: { ...t, cost: cost(t) }, total: { calls: all.calls || 0, fails: all.fails || 0, cost: cost(all) },
      days: days.map((d) => ({ day: d.day, calls: d.calls, cost: cost(d) })),
    };
  }

  async allow(ip, now) {
    const who = (await sha('ai-support:' + ip)).slice(0, 24);   // IP는 그대로 남기지 않음
    const day = kstDay(now);
    const r = this.sql.exec('SELECT day, n, last FROM limits WHERE who=?', who).toArray()[0];
    let n = r && r.day === day ? r.n : 0;
    if (r && now - r.last < GAP_MS) return '조금 뒤에 다시 해 주세요';
    if (n >= PER_DAY) return '오늘은 더 기록할 수 없어요';
    this.sql.exec('INSERT OR REPLACE INTO limits(who, day, n, last) VALUES(?,?,?,?)', who, day, n + 1, now);
    return null;
  }

  // 만들기 기록. { ok, id } 또는 { error }
  async add(body, ip) {
    const now = Date.now();
    const err = await this.allow(ip, now);
    if (err) return { error: err };
    const f = cleanForm(body.form);
    if (!(f.steps.length || f.free)) return { error: '내용이 없어요' };
    const sid = /^[a-z0-9]{8,40}$/.test(body.sid || '') ? body.sid : '';
    const kind = KINDS[body.kind] || 1;
    const promptLen = Math.max(0, Math.min(100000, +body.promptLen || 0));
    const hash = (await sha(JSON.stringify(f))).slice(0, 32);
    if (sid) {
      const old = this.sql.exec('SELECT id, kinds FROM logs WHERE sid=? AND hash=? AND at>? ORDER BY at DESC LIMIT 1', sid, hash, now - SAME_MS).toArray()[0];
      if (old) {
        this.sql.exec('UPDATE logs SET kinds=?, at=?, prompt_len=? WHERE id=?', old.kinds | kind, now, promptLen, old.id);
        return { ok: true, id: old.id, merged: true };
      }
    }
    const id = now.toString(36) + crypto.randomUUID().replace(/-/g, '').slice(0, 10);
    this.sql.exec(`INSERT INTO logs(id, at, day, sid, hash, kinds, example, mode, name, steps, free, output, role, tone, rules, step_count, prompt_len)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      id, now, kstDay(now), sid, hash, kind, body.example ? 1 : 0, f.mode, f.name, JSON.stringify(f.steps), f.free,
      f.output, f.role, f.tone, f.rules, f.steps.length, promptLen);
    const total = this.sql.exec('SELECT COUNT(*) AS c FROM logs').one().c;
    if (total > KEEP) this.sql.exec('DELETE FROM logs WHERE id IN (SELECT id FROM logs ORDER BY at ASC LIMIT ?)', total - KEEP);
    return { ok: true, id };
  }

  // 복사·저장을 눌렀다는 표시
  async mark(id, what, sid) {
    const col = what === 'save' ? 'saved' : 'copied';
    const c = this.sql.exec(`UPDATE logs SET ${col}=1 WHERE id=? AND sid=?`, id, sid || '').rowsWritten;
    return { ok: c > 0 };
  }

  rows(where = '', args = [], limit = 200, offset = 0) {
    return this.sql.exec(`SELECT * FROM logs ${where} ORDER BY at DESC LIMIT ? OFFSET ?`, ...args, limit, offset)
      .toArray().map((r) => ({ ...r, steps: JSON.parse(r.steps || '[]'), kind: kindName(r.kinds) }));
  }

  async list({ limit = 100, offset = 0, q = '', examples = false } = {}) {
    const w = []; const a = [];
    if (!examples) w.push('example=0');
    if (q) { w.push('(name LIKE ? OR steps LIKE ? OR free LIKE ? OR role LIKE ? OR output LIKE ?)'); const p = '%' + q.replace(/[%_]/g, '') + '%'; a.push(p, p, p, p, p); }
    const where = w.length ? 'WHERE ' + w.join(' AND ') : '';
    const total = this.sql.exec(`SELECT COUNT(*) AS c FROM logs ${where}`, ...a).one().c;
    return { total, items: this.rows(where, a, Math.min(500, limit), offset) };
  }

  async stats() {
    const one = (q, ...a) => this.sql.exec(q, ...a).one();
    const all = (q, ...a) => this.sql.exec(q, ...a).toArray();
    const base = 'FROM logs WHERE example=0';
    const t = one(`SELECT COUNT(*) AS n, COUNT(DISTINCT NULLIF(sid,'')) AS people, SUM(copied) AS copied, SUM(saved) AS saved,
      SUM(kinds & 1 > 0) AS tpl, SUM(kinds & 2 > 0) AS ai, AVG(CASE WHEN mode='steps' THEN step_count END) AS avg_steps,
      SUM(mode='free') AS free ${base}`);
    const days = all(`SELECT day, COUNT(*) AS n, COUNT(DISTINCT NULLIF(sid,'')) AS people ${base} GROUP BY day ORDER BY day DESC LIMIT 30`).reverse();
    const tones = all(`SELECT tone AS k, COUNT(*) AS n ${base} GROUP BY tone ORDER BY n DESC LIMIT 10`);
    const roles = all(`SELECT role AS k, COUNT(*) AS n ${base} AND role<>'' GROUP BY role ORDER BY n DESC LIMIT 15`);
    const outputs = all(`SELECT output AS k, COUNT(*) AS n ${base} AND output<>'' GROUP BY output ORDER BY n DESC LIMIT 15`);
    const examples = one('SELECT COUNT(*) AS n FROM logs WHERE example=1').n;
    // 자주 나오는 낱말 (업무 이름·단계·설명에서, 최근 3000건)
    const recent = all(`SELECT name, steps, free ${base} ORDER BY at DESC LIMIT 3000`);
    const cnt = new Map();
    for (const r of recent) {
      const text = [r.name, ...JSON.parse(r.steps || '[]'), r.free].join(' ');
      const seen = new Set();
      for (let w of text.split(/[^\p{L}\p{N}]+/u)) {
        w = stripJosa(w);
        if (Array.from(w).length < 2 || STOP.has(w) || /^\d+$/.test(w) || seen.has(w)) continue;
        seen.add(w); cnt.set(w, (cnt.get(w) || 0) + 1);
      }
    }
    const words = [...cnt].sort((a, b) => b[1] - a[1]).slice(0, 40).map(([k, n]) => ({ k, n }));
    return { total: t, days, tones, roles, outputs, words, examples, ai: this.aiStats() };
  }

  async exportRows() { return this.rows('', [], 100000, 0); }
  async remove(id) { return this.sql.exec('DELETE FROM logs WHERE id=?', id).rowsWritten > 0; }
}

const JOSA = ['에서는', '으로는', '에게서', '까지', '부터', '에서', '에게', '으로', '하고', '이랑', '처럼', '보다', '마다', '은', '는', '이', '가', '을', '를', '의', '에', '와', '과', '로', '도', '만', '랑'];
function stripJosa(w) {
  for (const j of JOSA) if (w.length > j.length + 1 && w.endsWith(j)) return w.slice(0, -j.length);
  return w;
}
const STOP = new Set(['이메일', '전화번호', '주민번호', '번호', '한다', '하기', '해서', '하고', '있는', '없는', '그리고', '그래서', '그런', '이런', '저런', '것을', '것은', '하는', '되는', '모두', '각각', '아래', '위에', '다음', '먼저', '같은', '대한', '위한', '통해', '만든다', '만들기', '쓴다', '찾는다', '확인한다', '있으면', '없으면', '해요', '해줘', '주세요']);
