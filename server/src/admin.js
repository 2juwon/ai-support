/* 관리 페이지: 비밀번호는 이 브라우저에만 저장하고 요청마다 헤더로 보냄 */
export const ADMIN_HTML = `<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>프롬프트 공방 기록</title>
<style>
:root{--bg:#f3f4f7;--surface:#fff;--sunk:#e9ebf1;--line:#d5d9e3;--fg:#1b2130;--muted:#5d6577;--accent:#2b59c3;--accent-ink:#fff;--accent-soft:#e3eafb;--step:#c7861a;--warn:#b4471f;color-scheme:light}
@media (prefers-color-scheme:dark){:root{--bg:#12151d;--surface:#1a1f2a;--sunk:#232937;--line:#323a4b;--fg:#e7eaf2;--muted:#9aa3b6;--accent:#7b9ff0;--accent-ink:#0f1422;--accent-soft:#25304a;--step:#e3a84a;--warn:#f0875e;color-scheme:dark}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--fg);font:15px/1.55 "Apple SD Gothic Neo","Malgun Gothic","Noto Sans KR",system-ui,sans-serif}
main{max-width:980px;margin:0 auto;padding:20px 16px 48px;display:flex;flex-direction:column;gap:14px}
h1{font-size:1.4rem;margin:0}h2{font-size:1rem;margin:0 0 10px}.sub{color:var(--muted);margin:2px 0 0;font-size:.88rem}
.card{background:var(--surface);border:1px solid var(--line);border-radius:10px;padding:16px;min-width:0}
.row{display:flex;gap:8px;align-items:center;flex-wrap:wrap}
input,button{font:inherit}input{flex:1;min-width:0;min-height:40px;border-radius:8px;border:1px solid var(--line);padding:0 10px;background:var(--bg);color:var(--fg)}
button{min-height:36px;border-radius:8px;border:1px solid var(--line);background:var(--surface);color:var(--fg);padding:0 13px;cursor:pointer}
button:hover{border-color:var(--accent)}button.primary{background:var(--accent);color:var(--accent-ink);border-color:var(--accent);font-weight:600}
.kpis{display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:10px}
.kpi{background:var(--surface);border:1px solid var(--line);border-radius:10px;padding:12px 14px}
.kpi b{display:block;font-size:1.5rem;font-variant-numeric:tabular-nums;line-height:1.2}.kpi span{color:var(--muted);font-size:.8rem}
.grid2{display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:14px}
.bars{display:flex;align-items:flex-end;gap:3px;height:120px;padding-top:6px}
.bars div{flex:1;background:var(--accent);border-radius:3px 3px 0 0;min-height:2px;position:relative}
.bars div:hover::after{content:attr(data-t);position:absolute;bottom:100%;left:50%;transform:translateX(-50%);background:var(--fg);color:var(--bg);font-size:.72rem;padding:2px 6px;border-radius:4px;white-space:nowrap}
.axis{display:flex;justify-content:space-between;color:var(--muted);font-size:.72rem;margin-top:4px}
.chips{display:flex;flex-wrap:wrap;gap:6px}.chip{background:var(--sunk);border-radius:999px;padding:3px 10px;font-size:.84rem}.chip small{color:var(--muted);margin-left:4px}
.hl{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:6px}
.hl li{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:8px;font-size:.88rem}
.hl li span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.hl .bar{grid-column:1/-1;height:4px;background:var(--sunk);border-radius:2px}.hl .bar i{display:block;height:100%;background:var(--step);border-radius:2px}
.item{border-top:1px solid var(--line);padding:12px 0}.item:first-child{border-top:0}
.item h3{margin:0;font-size:.98rem}.meta{color:var(--muted);font-size:.78rem}
.badge{font-size:.72rem;font-weight:600;border-radius:999px;padding:1px 8px;background:var(--accent-soft);color:var(--accent)}
.item ol{margin:6px 0 0;padding-left:22px;font-size:.88rem}.item p{margin:6px 0 0;font-size:.88rem;white-space:pre-wrap;word-break:break-word}
.kv{font-size:.82rem;color:var(--muted);margin-top:6px}.kv b{color:var(--fg);font-weight:500}
#box{display:flex;flex-direction:column;gap:14px}#box[hidden],[hidden]{display:none!important}.empty{color:var(--muted)}.err{color:var(--warn)}
</style></head><body><main>
<header><h1>업무 프롬프트 공방 — 모인 기록</h1><p class="sub">페이지에서 프롬프트를 만들 때 익명으로 남은 입력 내용이에요. 예시를 그대로 누른 기록은 통계에서 빼요.</p></header>
<div class="card" id="login"><div class="row"><input id="key" type="password" placeholder="관리자 비밀번호" autocomplete="current-password"><button class="primary" id="go">열기</button></div><p class="meta err" id="msg"></p></div>
<div id="box" hidden>
<div class="row"><button id="reload">새로고침</button><button id="csv">엑셀용 CSV 받기</button><span class="meta" id="when" style="margin-left:auto"></span></div>
<div class="kpis" id="kpis"></div>
<div class="card"><h2>날짜별 기록 (최근 30일)</h2><div class="bars" id="bars"></div><div class="axis" id="axis"></div></div>
<div class="card"><h2>자주 나오는 낱말 <span class="meta">업무 이름·작업 순서·설명</span></h2><div class="chips" id="words"></div></div>
<div class="grid2"><div class="card"><h2>받고 싶은 결과</h2><ul class="hl" id="outputs"></ul></div><div class="card"><h2>AI 역할</h2><ul class="hl" id="roles"></ul></div><div class="card"><h2>말투</h2><ul class="hl" id="tones"></ul></div></div>
<div class="card"><div class="row" style="margin-bottom:6px"><h2 style="margin:0">기록 목록</h2><span class="meta" id="lcount"></span></div>
<div class="row" style="margin-bottom:6px"><input id="q" placeholder="낱말로 찾기 (예: 견적, 회의록)"><button id="find">찾기</button><label class="meta"><input type="checkbox" id="ex" style="min-height:0;flex:none"> 예시 포함</label></div>
<div id="list"></div><div class="row" style="justify-content:center;margin-top:8px"><button id="more" hidden>더 보기</button></div></div>
</div>
</main><script>
const $=s=>document.querySelector(s);let key='';try{key=localStorage.getItem('ps-admin')||''}catch(e){}
async function api(p,o={}){const r=await fetch(p,{...o,headers:{'x-admin-key':key,'content-type':'application/json'}});if(!r.ok){const j=await r.json().catch(()=>({}));throw new Error(j.error||('오류 '+r.status))}return r}
const el=(t,c,txt)=>{const e=document.createElement(t);if(c)e.className=c;if(txt!=null)e.textContent=txt;return e};
const pct=(a,b)=>b?Math.round(a*100/b)+'%':'-';
const fmt=t=>new Date(t).toLocaleString('ko-KR',{timeZone:'Asia/Seoul',month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit'});
async function load(){try{const s=await(await api('/api/admin/stats')).json();try{localStorage.setItem('ps-admin',key)}catch(e){}$('#login').hidden=true;$('#box').hidden=false;draw(s);offset=0;$('#list').innerHTML='';await loadList()}catch(e){$('#msg').textContent=e.message;$('#login').hidden=false;$('#box').hidden=true}}
function draw(s){const t=s.total;$('#when').textContent=new Date().toLocaleTimeString('ko-KR')+' 기준';
const K=$('#kpis');K.innerHTML='';[[t.n||0,'만든 프롬프트'],[t.people||0,'만든 사람(브라우저)'],[pct(t.copied,t.n),'복사까지 함'],[pct(t.saved,t.n),'내 목록에 저장'],[(t.ai||0)+' / '+(t.tpl||0),'AI 다듬기 / 틀'],[t.avg_steps?(+t.avg_steps).toFixed(1):'-','평균 단계 수'],[s.examples,'예시 그대로 (제외)']].forEach(([v,l])=>{const d=el('div','kpi');d.append(el('b','',String(v)),el('span','',l));K.append(d)});
const B=$('#bars');B.innerHTML='';const max=Math.max(1,...s.days.map(d=>d.n));s.days.forEach(d=>{const b=el('div');b.style.height=(d.n/max*100)+'%';b.dataset.t=d.day.slice(5)+' · '+d.n+'건 · '+d.people+'명';B.append(b)});
$('#axis').innerHTML='';if(s.days.length){$('#axis').append(el('span','',s.days[0].day.slice(5)),el('span','',s.days[s.days.length-1].day.slice(5)))}else B.append(el('p','empty','아직 기록이 없어요'));
const W=$('#words');W.innerHTML='';if(!s.words.length)W.append(el('span','empty','아직 없어요'));s.words.forEach(w=>{const c=el('span','chip',w.k);c.append(el('small','',w.n));W.append(c)});
for(const k of ['outputs','roles','tones']){const L=$('#'+k);L.innerHTML='';const m=Math.max(1,...s[k].map(x=>x.n));if(!s[k].length)L.append(el('li','empty','아직 없어요'));s[k].forEach(x=>{const li=el('li');li.append(el('span','',x.k||'(비어 있음)'),el('small','meta',x.n+'건'));const bar=el('div','bar');const i=el('i');i.style.width=(x.n/m*100)+'%';bar.append(i);li.append(bar);L.append(li)})}}
let offset=0;
async function loadList(){const q=encodeURIComponent($('#q').value.trim());const r=await(await api('/api/admin/logs?limit=50&offset='+offset+'&q='+q+'&examples='+($('#ex').checked?1:0))).json();
$('#lcount').textContent='· '+r.total+'건';const L=$('#list');if(!r.items.length&&!offset)L.append(el('p','empty','기록이 없어요'));
for(const it of r.items){const d=el('div','item');const top=el('div','row');top.append(el('h3','',it.name||'(이름 없음)'),el('span','badge',{tpl:'틀',ai:'AI',both:'틀+AI'}[it.kind]));if(it.example)top.append(el('span','badge','예시'));if(it.copied)top.append(el('span','badge','복사'));if(it.saved)top.append(el('span','badge','저장'));
const del=el('button','','지우기');del.style.marginLeft='auto';del.onclick=async()=>{if(del.dataset.sure!=='1'){del.dataset.sure='1';del.textContent='한 번 더 누르면 지워요';return}await api('/api/admin/logs/'+it.id,{method:'DELETE'});d.remove()};top.append(del);d.append(top,el('div','meta',fmt(it.at)+' · 익명 '+(it.sid||'-').slice(0,6)));
if(it.steps.length){const ol=el('ol');it.steps.forEach(s=>ol.append(el('li','',s)));d.append(ol)}if(it.free)d.append(el('p','',it.free));
const kv=el('div','kv');[['결과',it.output],['역할',it.role],['말투',it.tone],['지킬 것',it.rules]].forEach(([k,v])=>{if(v){const s=el('span');s.append(k+': ',el('b','',v),'  ');kv.append(s)}});d.append(kv);L.append(d)}
offset+=r.items.length;$('#more').hidden=offset>=r.total}
$('#go').onclick=()=>{key=$('#key').value;load()};$('#key').onkeydown=e=>{if(e.key==='Enter'){key=$('#key').value;load()}};
$('#reload').onclick=load;$('#more').onclick=loadList;
const find=()=>{offset=0;$('#list').innerHTML='';loadList()};$('#find').onclick=find;$('#q').onkeydown=e=>{if(e.key==='Enter')find()};$('#ex').onchange=find;
$('#csv').onclick=async()=>{const b=$('#csv');b.disabled=true;try{const r=await api('/api/admin/export.csv');const blob=await r.blob();const a=el('a');a.href=URL.createObjectURL(blob);a.download='ai-support-'+new Date().toISOString().slice(0,10)+'.csv';document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(a.href),5000)}catch(e){alert(e.message)}b.disabled=false};
if(key)load();
</script></body></html>`;
