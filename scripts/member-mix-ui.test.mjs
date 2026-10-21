import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs/promises';import vm from 'node:vm';
const ui=await fs.readFile(new URL('../app/member-mix.js',import.meta.url),'utf8');
function context(data={}){const c=vm.createContext({data});vm.runInContext(`const D=data,state={product:'win',month:'2026-10'};const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));const num=(v,d=0)=>v==null?'—':Number(v).toLocaleString('en-US',{minimumFractionDigits:d,maximumFractionDigits:d});const row=c=>'<tr>'+c.join('|')+'</tr>';const table=(h,r)=>h.join('|')+r.join('');`+ui,c);return c;}
const metric=(total,fresh,old,unknown=0,verified=true)=>({from:'2026-10-01',through:'2026-10-20',total,newRegistered:fresh,existing:old,unknown,verified,complete:verified,source:'驗證來源',capturedAt:'2026-10-21T01:00:00Z'});
function payload(){return{memberComposition:[{platform:'win',month:'2026-10',metrics:{deposit:metric(1000,200,800),paidMembers:metric(10,3,7),mau:{...metric(100,null,null),verified:false,complete:false},dau:{...metric(10,null,null),verified:false,complete:false}},cohortCoverage:{complete:true,uniqueAIDs:318,registrationCount:318},sources:[]}],channels:{periods:[]}};}
const render=c=>vm.runInContext("memberMixPanel('win','2026-10')",c);

test('availability is dynamic and a reported recovery never upgrades missing member data',()=>{
 const data={platforms:[{key:'bo',availability:{state:'recovery_reported'}}],memberComposition:[{platform:'bo',month:'2026-10',availability:{state:'temporarily_unavailable'},metrics:{}}]},c=context(data);let html=vm.runInContext("memberMixPanel('bo','2026-10')",c);assert.match(html,/已回報後台恢復登入/);assert.match(html,/恢復登入不代表資料已更新/);assert.doesNotMatch(html,/後台暫停，保留/);assert.match(html,/data-member-status="missing"/);assert.doesNotMatch(html,/data-member-status="verified"/);data.platforms[0].availability.state='temporarily_unavailable';html=vm.runInContext("memberMixPanel('bo','2026-10')",c);assert.match(html,/後台暫停，保留既有分群及實際截止日/);assert.doesNotMatch(html,/已回報後台恢復登入/);
});
test('verified financial composition displays both cash and payer shares while activity stays pending',()=>{
 const html=render(context(payload()));assert.ok(html.includes('官儲以既有玩家為主'));assert.ok(html.includes('80.00%'));assert.ok(html.includes('70.00%'));assert.ok(html.includes('data-member-metric="paidMembers" data-member-status="verified"'));assert.ok(html.includes('data-member-metric="mau" data-member-status="missing"'));assert.ok(html.includes('期間登入 AID'));assert.ok(html.includes('2026-10-01 — 2026-10-20'));assert.ok(!html.includes('NaN'));
});
test('partial matching exposes unknown as a third group without labelling unmatched members existing',()=>{
 const d=payload();d.memberComposition[0].metrics.deposit=metric(1000,200,0,800,false);d.memberComposition[0].metrics.paidMembers=metric(10,3,0,7,false);d.memberComposition[0].cohortCoverage.complete=false;const html=render(context(d));assert.ok(html.includes('官儲分群仍有待分類會員'));assert.ok(html.includes('待分類 800.00 元'));assert.ok(html.includes('class="mm-unknown"'));assert.ok(!html.includes('官儲以既有玩家為主'));assert.ok(html.includes('未匹配者保留待分類'));
});
test('old Win channel fallback is an explicitly unverified reference and cannot overwrite current composition',()=>{
 const d={channels:{periods:[{month:'2026-10',start:'2026-10-01',cutoff:'2026-10-19',firstPaidCash:80700,membersSource:{file:'old-members'},depositsSource:{file:'old-rank'}}]}};const html=render(context(d));assert.ok(html.includes('舊渠道快照參考 · 不作本期完整分群'));assert.ok(html.includes('80,700.00'));assert.ok(html.includes('不將其餘金額自動歸為既有玩家'));assert.ok(!html.includes('data-member-status="verified"'));assert.ok(!html.includes('官儲以既有玩家為主'));
});
test('wrong-month metrics, incomplete verified claims and invalid sums never become verified charts',()=>{
 const d=payload();d.memberComposition[0].metrics.deposit.through='2026-09-20';d.memberComposition[0].metrics.paidMembers.total=20;const html=render(context(d));assert.ok(!html.includes('data-member-status="verified"'));assert.ok(!html.includes('官儲以既有玩家為主'));
 const x=payload();x.memberComposition[0].metrics.deposit.complete=false;assert.ok(render(context(x)).includes('data-member-metric="deposit" data-member-status="observed"'));
});
test('explicit zero has no fabricated percentages and names/source metadata escape markup without mutating payload',()=>{
 const d=payload();d.memberComposition[0].metrics.deposit=metric(0,0,0);d.memberComposition[0].metrics.paidMembers=metric(0,0,0);d.memberComposition[0].metrics.deposit.source='<img src=x onerror=bad>';d.memberComposition[0].sources=[{file:'<script>bad</script>',from:'2026-10-01',through:'2026-10-20',complete:true}];const before=JSON.stringify(d),html=render(context(d));assert.ok(html.includes('此期間尚無官儲'));assert.ok(html.includes('0.00'));assert.ok(!html.includes('NaN'));assert.ok(!html.includes('<img'));assert.ok(!html.includes('<script>'));assert.ok(html.includes('&lt;img'));assert.equal(JSON.stringify(d),before);
});
test('competitor lacking member-level permission keeps all split metrics missing with explicit gaps',()=>{
 const c=context({memberComposition:[{platform:'o8',month:'2026-10',metrics:{},sources:[],cohortCoverage:{complete:false}}]}),html=vm.runInContext("memberMixPanel('o8','2026-10')",c);assert.ok(html.includes('競品若權限未開放會員明細'));assert.ok(!html.includes('data-member-status="verified"'));assert.ok(html.includes('待分類'));assert.ok(!html.includes('NaN'));
});
test('a verified older grouping prominently keeps its original cutoff and never claims the latest period',()=>{
 const d=payload();d.memberComposition[0].requestedThrough='2026-10-20';for(const r of Object.values(d.memberComposition[0].metrics))r.through='2026-10-19';const html=render(context(d));assert.ok(html.includes('本區付費分群截至 2026-10-19'));assert.ok(html.includes('本次目標 2026-10-20'));assert.ok(html.includes('未將舊期延伸到新截止日'));
});
