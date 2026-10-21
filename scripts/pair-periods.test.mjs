import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';

const app=await fs.readFile(new URL('../app/app.js',import.meta.url),'utf8');
const prefix=app.slice(0,app.indexOf('let chartSequence=0;'));
const portfolio=await fs.readFile(new URL('../app/all-platforms.js',import.meta.url),'utf8');
const overview=await fs.readFile(new URL('../app/overview-v2.js',import.meta.url),'utf8');
const fixture=JSON.parse(await fs.readFile(new URL('../data/dashboard.json',import.meta.url),'utf8'));
function harness(data){
 const charts=[],context=vm.createContext({payload:data,chart:(series,labels)=>{charts.push(JSON.parse(JSON.stringify({series,labels})));return'<figure>chart</figure>'}});
 vm.runInContext(prefix+'\nD=payload;',context);return{context,charts,pair:(platform,month)=>vm.runInContext(`pair(${JSON.stringify(platform)},${JSON.stringify(month)})`,context)};
}
function rows(month,days,cash=1){return Array.from({length:days},(_,i)=>[month+'-'+String(i+1).padStart(2,'0'),10,2,2,cash,20,null,null,0,0])}
function synthetic(current,previous){return harness({daily:{demo:[...previous,...current]}})}

test('closed 30-day month compares with every day of the prior 31-day month',()=>{
 const h=synthetic(rows('2026-09',30),rows('2026-08',31,2)),p=h.pair('demo','2026-09');
 assert.equal(p.fullMonth,true);assert.equal(p.day,30);assert.equal(p.previousDay,31);assert.equal(p.b.at(-1)[0],'2026-08-31');assert.equal(p.before.cash,62);assert.equal(p.now.cash,30);assert.equal(p.comparable,true);
 h.context.period=p;assert.match(vm.runInContext('pairPeriodText(period)',h.context),/2026-09 整月（30 日）對 2026-08 整月（31 日）/);
});
test('closed months cover February, leap years and a year boundary',()=>{
 for(const [month,days,prior,priorDays] of [['2026-03',31,'2026-02',28],['2024-03',31,'2024-02',29],['2024-02',29,'2024-01',31],['2027-01',31,'2026-12',31]]){
  const p=synthetic(rows(month,days),rows(prior,priorDays)).pair('demo',month);assert.equal(p.comparable,true,month);assert.equal(p.previousDay,priorDays);assert.equal(p.before.cash,priorDays);
 }
});
test('partial month keeps the same day count and excludes later prior dates',()=>{
 const h=synthetic(rows('2026-10',19),rows('2026-09',30,2)),p=h.pair('demo','2026-10');assert.equal(p.fullMonth,false);assert.equal(p.previousDay,19);assert.equal(p.b.length,19);assert.equal(p.b.at(-1)[0],'2026-09-19');assert.equal(p.before.cash,38);assert.equal(p.comparable,true);
 h.context.period=p;assert.equal(vm.runInContext('pairPeriodText(period)',h.context),'2026-10 1–19 日對 2026-09 1–19 日');
});
test('partial month longer than the preceding calendar month does not invent dates or compare unequal day counts',()=>{
 const p=synthetic(rows('2026-03',30),rows('2026-02',28)).pair('demo','2026-03');assert.equal(p.fullMonth,false);assert.equal(p.previousDay,30);assert.equal(p.b.length,28);assert.equal(p.previousComplete,false);assert.equal(p.comparable,false);assert.equal(p.b.at(-1)[0],'2026-02-28');
});
test('current or prior date gaps and duplicate dates prevent comparison',()=>{
 for(const edit of [data=>data.current.splice(16,1),data=>data.previous.splice(16,1),data=>data.current[16]=data.current[15],data=>data.previous[16]=data.previous[15]]){
  const data={current:rows('2026-09',30),previous:rows('2026-08',31)};edit(data);assert.equal(synthetic(data.current,data.previous).pair('demo','2026-09').comparable,false);
 }
 const nullCash=rows('2026-09',30);nullCash[3][4]=null;assert.equal(synthetic(nullCash,rows('2026-08',31)).pair('demo','2026-09').comparable,false);
});
test('ordering does not mutate source records; actual zero amounts remain known zero',()=>{
 const current=rows('2026-09',30,0).reverse(),previous=rows('2026-08',31,0).reverse(),source={daily:{demo:[...current,...previous]}},before=JSON.stringify(source),p=harness(source).pair('demo','2026-09');assert.equal(p.comparable,true);assert.equal(p.now.cash,0);assert.equal(p.before.cash,0);assert.equal(p.a[0][0],'2026-09-01');assert.equal(JSON.stringify(source),before);
 const empty=synthetic([],previous).pair('demo','2026-09');assert.equal(empty.comparable,false);assert.equal(empty.now,null);assert.equal(empty.b.length,0);
});
test('real Win opening-month gaps on January 17–18 remain gaps and block February comparison',()=>{
 const h=harness(fixture),jan=h.pair('win','2026-01'),feb=h.pair('win','2026-02');
 assert(!jan.a.some(r=>r[0]==='2026-01-17'));assert(!jan.a.some(r=>r[0]==='2026-01-18'));assert.equal(jan.currentComplete,false);assert.equal(jan.comparable,false);assert.equal(feb.previousComplete,false);assert.equal(feb.comparable,false);
});
test('real September full-month cash, merchant and formula-revenue ranges now agree for three verified sites',()=>{
 const h=harness(fixture);vm.runInContext(portfolio,h.context);const stations=[];
 for(const key of ['win','qz','song']){
  const p=h.pair(key,'2026-09'),f=fixture.funding.find(f=>f.platform===key&&f.month==='2026-09');assert.equal(p.comparable,true,key);assert.equal(p.b.length,31);assert.equal(p.b.at(-1)[0],f.prevThrough);assert.equal(p.before.cash,f.prevDirectCash);
  const s={...p,p:{key,name:key},fund:f,through:p.a.at(-1)[0],complete:p.currentComplete,canCompare:p.comparable};stations.push(s);h.context.station=s;
  const r=vm.runInContext('portfolioRevenue(station)',h.context);assert.equal(r.previousBuyAmount,f.prevBuyCoins/fixture.coinConversion.rates[key].buyDivisor);assert.notEqual(r.previousRevenue,null);
 }
 h.context.stations=stations;assert.match(vm.runInContext('portfolioBuyAnalysis(stations)',h.context),/已知可比 3 站中，1 站買幣下降/);
});
test('single-site September overview compares full-month cards and plots August 31 without a fake September 31',()=>{
 const h=harness(fixture);vm.runInContext(overview,h.context);vm.runInContext("Object.assign(state,{product:'win',month:'2026-09',year:2026});this.html=overviewV2();",h.context);
 assert.match(h.context.html,/官儲較同期/);assert.match(h.context.html,/本月 30 日、前月 31 日/);assert.match(h.context.html,/9\/1–9\/30 ／ 8\/1–8\/31/);
 const daily=h.charts.find(c=>c.labels.length===31);assert(daily);assert.equal(daily.series[0].values[30],null);assert.equal(daily.series[1].values[30],fixture.daily.win.find(r=>r[0]==='2026-08-31')[4]);
});
test('October uses matched cash days and only combines coin totals with the same cutoff',()=>{
 const h=harness(fixture),p=h.pair('win','2026-10'),expectedDays=Number(fixture.platforms.find(x=>x.key==='win').dailyThrough.slice(8)),fund=fixture.funding.find(f=>f.platform==='win'&&f.month==='2026-10');assert.equal(p.fullMonth,false);assert.equal(p.comparable,true);assert.equal(p.a.length,expectedDays);assert.equal(p.b.length,expectedDays);
 vm.runInContext(portfolio,h.context);h.context.station={...p,p:{key:'win'},fund,through:p.a.at(-1)[0],complete:p.currentComplete,canCompare:p.comparable};
 const expected=fund.through===p.a.at(-1)[0]?fund.directCash+fund.buyCoins/fixture.coinConversion.rates.win.buyDivisor-fund.sellCoins/fixture.coinConversion.rates.win.sellDivisor:null;
 assert.equal(vm.runInContext('portfolioRevenue(station).revenue',h.context),expected);
});
