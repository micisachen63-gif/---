import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';

const root=new URL('../',import.meta.url);
const app=await fs.readFile(new URL('app/app.js',root),'utf8');
const source=await fs.readFile(new URL('app/all-platforms.js',root),'utf8');
const coinHelpers=app.slice(app.indexOf('function coinPolicy(){'),app.indexOf('const sec='));
function harness(policy={rates:{demo:{buyDivisor:2,sellDivisor:2.5}}}){
 const c=vm.createContext({COIN_CONVERSION_POLICY:policy,state:{month:'2000-10'},D:{}});
 vm.runInContext(`const num=(v,d=0)=>v==null?'—':Number(v).toLocaleString('en-US',{minimumFractionDigits:d,maximumFractionDigits:d});const esc=v=>String(v??'');const change=(a,b)=>a==null||b==null||b===0?null:a/b-1;const percent=v=>v===null?'—':(v*100).toFixed(1)+'%';const trend=v=>v===null?'無可比資料':percent(v);`,c);
 vm.runInContext(coinHelpers+'\n'+source,c);
 return c;
}
function station(){
 const rows=(month,values)=>values.map((cash,i)=>[month+'-'+String(i+1).padStart(2,'0'),10,1,1,cash,10,0,0,0,0]);
 return{p:{key:'demo',name:'Demo'},a:rows('2000-10',[100,200]),b:rows('2000-09',[200,200]),now:{cash:300,dau:10,payRate:.1},before:{cash:400,dau:10,payRate:.1},complete:true,canCompare:true,through:'2000-10-02',fund:{covered:true,previousMerchantCovered:true,from:'2000-10-01',through:'2000-10-02',to:'2000-10-02',directCash:300,buyCoins:600,sellCoins:250,prevFrom:'2000-09-01',prevThrough:'2000-09-02',prevDirectCash:400,prevBuyCoins:800,prevSellCoins:250}};
}
function result(c,s){c.input=s;return vm.runInContext('portfolioRevenue(input)',c);}

test('card leads with formula revenue and explains cash, buy and sell changes',()=>{
 const c=harness(),s=station(),r=result(c,s);assert.equal(r.revenue,500);assert.equal(r.previousRevenue,700);assert.equal(r.delta,-200);
 c.input=s;const html=vm.runInContext("portfolioCard(input,'#abc')",c);
 assert.match(html,/data-portfolio-revenue="demo">500\.00/);assert.ok(html.indexOf('data-portfolio-revenue')<html.indexOf('portfolio-cash-component'));
 assert.match(html,/官儲差 -100\.00 ＋ 買幣折現差 -100\.00 − 賣幣折現差 0\.00/);assert.match(html,/前月同期/);assert.match(html,/原始金幣與公式/);assert.match(html,/-25\.0%/);
});

test('uncovered, mismatched or missing cash and coin inputs cannot become revenue',()=>{
 for(const alter of [s=>{s.fund.covered=false;},s=>{s.fund.from='2000-10-02';},s=>{s.fund.through='2000-10-03';},s=>{s.fund.directCash=301;},s=>{s.fund.buyCoins=null;},s=>{s.a[0][4]=null;},s=>{s.complete=false;}]){
  const c=harness(),s=station();alter(s);const r=result(c,s);assert.equal(r.revenue,null);
  c.input=s;const html=vm.runInContext("portfolioCard(input,'#abc')",c);assert.match(html,/data-portfolio-revenue="demo">—/);assert.match(html,/官儲/);if(s.a.some(row=>row[4]===null)){assert.equal(r.current,null);assert.match(html,/官儲來源未齊/);assert.match(html,/portfolio-cash-component[\s\S]*?<strong>—<\/strong>/);}else assert.match(html,/300/);
 }
 const c=harness({rates:{}}),r=result(c,station());assert.equal(r.revenue,null);assert.equal(r.buyAmount,null);
});

test('comparison rejects a prior period with different dates, coverage or official deposit',()=>{
 for(const alter of [s=>{s.fund.previousMerchantCovered=false;},s=>{s.fund.prevThrough='2000-09-30';},s=>{s.fund.prevFrom='2000-08-01';},s=>{s.fund.prevDirectCash=401;},s=>{s.b[0][4]=null;}]){
  const c=harness(),s=station();alter(s);const r=result(c,s);assert.equal(r.revenue,500);assert.equal(r.previousRevenue,null);assert.equal(r.previousBuyAmount,null);assert.equal(r.delta,null);
 }
});

test('verified zero coins and revenue remain zero; unknown sites never join a total',()=>{
 const c=harness(),s=station();s.now.cash=0;s.a.forEach(r=>r[4]=0);Object.assign(s.fund,{directCash:0,buyCoins:0,sellCoins:0});assert.equal(result(c,s).revenue,0);
 c.input=[s,...Array.from({length:5},(_,i)=>({...station(),p:{key:'unconnected'+i,name:'Pending'},fund:null}))];
 const html=vm.runInContext('portfolioBuyAnalysis(input)',c);assert.match(html,/已知 1 \/ 6 站 · 資料不完整/);assert.match(html,/六站本期買幣合計 · 台幣<\/span><strong>—/);assert.match(html,/未知站點不列下降/);
});

test('buy totals require all six sources and a shared date range',()=>{
 const c=harness(),sites=Array.from({length:6},()=>station());c.input=sites;let html=vm.runInContext('portfolioBuyAnalysis(input)',c);assert.match(html,/六站本期買幣合計 · 台幣<\/span><strong>1,800\.00/);
 sites[5].through='2000-10-03';sites[5].a.push(['2000-10-03',10,1,1,0,10,0,0,0,0]);sites[5].fund.through=sites[5].fund.to=sites[5].through;
 html=vm.runInContext('portfolioBuyAnalysis(input)',c);assert.match(html,/六站本期買幣合計 · 台幣<\/span><strong>—/);
});

test('negative revenue remains negative and the comparison bar uses the correct side of zero',()=>{
 const c=harness(),s=station();s.fund.sellCoins=2500;const r=result(c,s);assert.equal(r.revenue,-400);
 c.input=s;const html=vm.runInContext("portfolioCard(input,'#abc')",c);
 assert.match(html,/data-portfolio-revenue="demo">-400\.00/);assert.match(html,/portfolio-micro-track signed/);assert.match(html,/right:50%/);assert.match(html,/left:50%/);assert.doesNotMatch(html,/NaN|Infinity/);
 s.fund.prevSellCoins=2500;assert.equal(result(c,s).previousRevenue,-200);assert.equal(result(c,s).rate,null);
 s.fund.sellCoins=1875;assert.equal(result(c,s).revenue,-150);c.input=s;
 const improved=vm.runInContext("portfolioCard(input,'#abc')",c);assert.match(improved,/營收同期增長/);assert.match(improved,/前期零或負營收，依差額比較/);
});

test('current backend fixture reconciles the verified Win 20-day formula against the exact prior 20 days',async()=>{
 const d=JSON.parse(await fs.readFile(new URL('data/dashboard.json',root),'utf8')),f=d.funding.find(f=>f.platform==='win'&&f.month==='2026-10');
 const a=d.daily.win.filter(r=>r[0]>=f.from&&r[0]<=f.through),b=d.daily.win.filter(r=>r[0]>=f.prevFrom&&r[0]<=f.prevThrough),sum=rows=>rows.reduce((v,r)=>v+r[4],0);
 const c=harness(d.coinConversion),s={...station(),p:{key:'win',name:'Win'},a,b,now:{cash:sum(a)},before:{cash:sum(b)},fund:f,through:f.through},r=result(c,s);
 assert.equal(f.from,'2026-10-01');assert.equal(f.through,'2026-10-20');assert.equal(f.prevFrom,'2026-09-01');assert.equal(f.prevThrough,'2026-09-20');assert.equal(a.length,20);assert.equal(b.length,20);assert.equal(r.current,723900);assert.equal(r.buyAmount,1474480);assert.equal(r.sellAmount,1671700);assert.equal(r.revenue,526680);assert.equal(r.previousRevenue,sum(b)+f.prevBuyCoins/d.coinConversion.rates.win.buyDivisor-f.prevSellCoins/d.coinConversion.rates.win.sellDivisor);
});
test('explicit verified 19-day transaction fixture remains 505130 and cannot silently extend to the 20th',async()=>{
 const d=JSON.parse(await fs.readFile(new URL('data/dashboard.json',root),'utf8')),a=d.daily.win.filter(r=>r[0]>='2026-10-01'&&r[0]<='2026-10-19'),b=d.daily.win.filter(r=>r[0]>='2026-09-01'&&r[0]<='2026-09-19'),sum=rows=>rows.reduce((s,r)=>s+r[4],0),coins=(from,to,key)=>(d.fundingDaily||[]).filter(r=>r.platform==='win'&&r.date>=from&&r.date<=to&&r.covered===true).reduce((s,r)=>s+r[key],0);
 const f={covered:true,previousMerchantCovered:true,from:'2026-10-01',through:'2026-10-19',to:'2026-10-19',prevFrom:'2026-09-01',prevThrough:'2026-09-19',directCash:sum(a),prevDirectCash:sum(b),buyCoins:coins('2026-10-01','2026-10-19','buyCoins'),sellCoins:coins('2026-10-01','2026-10-19','sellCoins'),prevBuyCoins:coins('2026-09-01','2026-09-19','buyCoins'),prevSellCoins:coins('2026-09-01','2026-09-19','sellCoins')};
 const c=harness(d.coinConversion),s={...station(),p:{key:'win',name:'Win'},a,b,now:{cash:sum(a)},before:{cash:sum(b)},fund:f,through:f.through};assert.equal(a.length,19);assert.equal(b.length,19);assert.equal(result(c,s).revenue,505130);
 const day20=d.daily.win.find(r=>r[0]==='2026-10-20');s.a=[...a,day20];s.now.cash+=day20[4];s.through='2026-10-20';assert.equal(result(c,s).revenue,null,'a 19-day merchant source cannot fill a 20-day revenue card');
});

test('paused Bo stays visible at its original cutoff and never joins the five-site subtotal',()=>{
 const keys=['win','qz','song','rd','lucky','bo'],policy={rates:Object.fromEntries(keys.map(key=>[key,{buyDivisor:2,sellDivisor:2.5}]))},c=harness(policy),sites=keys.map(key=>{const s=station();s.p={key,name:key==='bo'?'來博':key};return s;});
 const bo=sites[5];bo.p.availability={state:'temporarily_unavailable',message:'後台暫時無法連線',confirmedOn:'2000-10-03'};bo.through='2000-10-01';bo.a=bo.a.slice(0,1);bo.now.cash=100;Object.assign(bo.fund,{through:bo.through,to:bo.through,directCash:100});c.input=sites;
 const g=vm.runInContext('portfolioVerifiedSubtotal(input)',c);assert.equal(g.group.length,5);assert.equal(g.known,true);assert.equal(g.current.revenue,2500);assert.equal(g.current.cash,1500);assert.equal(g.current.buy,1500);assert.equal(g.current.sell,500);assert.equal(g.excluded[0].p.key,'bo');
 const html=vm.runInContext('portfolioSubtotalPanel(input)',c);assert.ok(html.includes('5站已核對小計（不含來博）'));assert.ok(html.includes('2000-10-01 — 2000-10-02'));assert.ok(!html.includes('六站已核對小計'));
 c.bo=bo;const card=vm.runInContext("portfolioCard(bo,'#abc')",c);assert.ok(card.includes('後台暫停 · 保留既有資料'));assert.ok(card.includes('目前資料截至 2000-10-01'));assert.ok(card.includes('data-portfolio-site="bo"'));assert.ok(card.includes('data-portfolio-revenue="bo">300.00'));
});
test('five-site subtotal refuses missing financial inputs rather than silently adding only four or substituting zeros',()=>{
 const c=harness(),sites=Array.from({length:5},()=>station());sites[4].fund=null;c.input=sites;const g=vm.runInContext('portfolioVerifiedSubtotal(input)',c);assert.equal(g.group.length,5);assert.equal(g.known,false);for(const key of ['cash','buy','sell','revenue'])assert.equal(g.current[key],null);
 const html=vm.runInContext('portfolioSubtotalPanel(input)',c);assert.ok(html.includes('同期間財務待核對'));assert.ok(!html.includes('5站已核對小計'));
});
test('subtotal selects one latest complete cutoff, labels its actual membership and requires at least two sites',()=>{
 const c=harness(),sites=Array.from({length:5},()=>station());sites[4].a=sites[4].a.slice(0,1);sites[4].through='2000-10-01';sites[4].now.cash=100;Object.assign(sites[4].fund,{through:sites[4].through,to:sites[4].through,directCash:100});c.input=sites;
 let g=vm.runInContext('portfolioVerifiedSubtotal(input)',c);assert.equal(g.group.length,4);assert.equal(g.current.revenue,2000);assert.equal(g.through,'2000-10-02');c.input=sites.slice(0,1);g=vm.runInContext('portfolioVerifiedSubtotal(input)',c);assert.equal(g.known,false);assert.equal(g.current.revenue,null);
});

test('available Bo with complete same-period funding joins the dynamic total and has no paused or excluded label',()=>{
 const keys=['win','qz','song','rd','lucky','bo'],c=harness({rates:Object.fromEntries(keys.map(key=>[key,{buyDivisor:2,sellDivisor:2.5}]))}),sites=keys.map(key=>{const s=station();s.p={key,name:key==='bo'?'來博':key};return s;});sites[5].p.availability={state:'available',confirmedOn:'2000-10-03'};c.input=sites;c.bo=sites[5];
 const g=vm.runInContext('portfolioVerifiedSubtotal(input)',c);assert.equal(g.known,true);assert.equal(g.group.length,6);assert.equal(g.excluded.length,0);assert.equal(g.current.revenue,3000);assert.equal(g.current.cash,1800);assert.equal(g.current.buy,1800);assert.equal(g.current.sell,600);
 const html=vm.runInContext('portfolioSubtotalPanel(input)',c);assert.match(html,/6站已核對合計/);assert.match(html,/實際營收合計/);assert.match(html,/全部 6 站已依相同截止日核對/);assert.doesNotMatch(html,/5站|不含來博|未納此小計|此小計不代替六站/);const card=vm.runInContext("portfolioCard(bo,'#abc')",c);assert.doesNotMatch(card,/後台暫停 · 保留既有資料|class="portfolio-state paused"/);assert.match(card,/data-portfolio-revenue="bo">500.00/);
 c.input=sites.slice(0,3);assert.match(vm.runInContext('portfolioSubtotalPanel(input)',c),/3站已核對合計/,'total count follows actual membership instead of a fixed six');
 sites[5].fund=null;c.input=sites;const missing=vm.runInContext('portfolioVerifiedSubtotal(input)',c);assert.equal(missing.known,false);assert.equal(missing.current.revenue,null);assert.equal(missing.current.cash,null,'availability alone does not make incomplete financial inputs known');
});
