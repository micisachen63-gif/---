// LEGACY_RATE_FIXTURE: injected 133/144 or alternate divisors test historical/custom DTO compatibility; current production rates come only from merchant-rates.json.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
const period={previousFrom:'2026-09-01',previousThrough:'2026-09-20',currentFrom:'2026-10-01',currentThrough:'2026-10-20'};
const rows=(month,n=20,cash=100)=>Array.from({length:n},(_,i)=>[month+'-'+String(i+1).padStart(2,'0'),50,2,3,cash,4,null,null,1,10]);
async function fixture(){
 const app=await fs.readFile(new URL('../app/app.js',import.meta.url),'utf8'),ui=await fs.readFile(new URL('../app/competitor-v2.js',import.meta.url),'utf8');
 const data={generatedAt:'2026-10-21T01:00:00Z',platforms:[{key:'win',name:'贏麻了',url:'https://admin.winmalo.com:9955/'}],daily:{win:[...rows('2026-09'),...rows('2026-10',20,80)]},retention:{win:[...rows('2026-09',19,0),...rows('2026-10',19,0)]},funding:[],competitors:[{key:'aos',name:'黑桃A',normalizedDaily:[...rows('2026-09'),...rows('2026-10')],url:'https://admin.aos888.com:9955/'}],coinConversion:{rates:{win:{buyDivisor:1.2,sellDivisor:1.22},aos:{buyDivisor:1.1,sellDivisor:1.11},o8:{buyDivisor:133,sellDivisor:144}}},marketFundingComparisons:{schema:1,period,rows:[{platform:'win',from:period.currentFrom,through:period.currentThrough,prevFrom:period.previousFrom,prevThrough:period.previousThrough,covered:true,previousCovered:true,buyCoins:120,sellCoins:244,prevBuyCoins:240,prevSellCoins:122,sourceFiles:['current.json'],previousSourceFiles:['previous.json'],capturedAt:'2026-10-21T01:00:00Z'},{platform:'aos',from:period.currentFrom,through:period.currentThrough,prevFrom:period.previousFrom,prevThrough:period.previousThrough,covered:true,previousCovered:true,buyCoins:0,sellCoins:0,prevBuyCoins:110,prevSellCoins:0}]}};
 const ctx=vm.createContext({console,URL,input:data});vm.runInContext(app.slice(0,app.indexOf('function selectProduct'))+'\n'+ui+'\nD=input;',ctx);return{ctx,data};
}
test('market compares all four measures in exactly the same 20-day scope, preserving independent missing registration',async()=>{
 const {ctx}=await fixture(),items=vm.runInContext('cv2BenchmarkItems()',ctx);assert.equal(items[0].current.cash,1600);assert.equal(items[0].current.dau,50);assert.equal(items[0].current.nu,null);assert.equal(items[0].current.buy,100);assert.equal(items[0].previous.buy,200);assert.equal(items[0].buy,-.5);assert.equal(items[0].current.sell,200);assert.equal(items[0].previous.sell,100);assert.equal(items[0].sell,1);
 const html=vm.runInContext('competitorBenchmarkPanel()',ctx);for(const text of ['官儲變化','日均活躍變化','買幣變化','賣幣變化','2026/09/01 — 09/20','2026/10/01 — 10/20','已確認幣商','候選情境','前期換算額','本期換算額'])assert.ok(html.includes(text),text);assert.ok(!html.includes('NaN'));assert.ok(!html.includes('undefined'));
});
test('stale derived amounts, 19-day windows, whole September and o8 seven-day observations never replace exact monthly pairs',async()=>{
 const {ctx,data}=await fixture();data.marketFundingComparisons.rows[0].through='2026-10-19';data.marketFundingComparisons.rows[1].buyAmount=999999;data.funding=[{platform:'win',from:'2026-10-01',through:'2026-10-20',prevFrom:'2026-09-01',prevThrough:'2026-09-30',covered:true,previousMerchantCovered:true,buyCoins:12000,sellCoins:12000,prevBuyCoins:12000,prevSellCoins:12000}];data.competitors.push({key:'o8',name:'發又發',normalizedDaily:[]});data.competitorArchive={platform:'o8',recentWindow:{complete:true,summary:{buyAmount:99999}},daily:[]};
 const items=vm.runInContext('cv2BenchmarkItems()',ctx);assert.equal(items[0].current.buy,null);assert.equal(items[0].previous.buy,null);assert.equal(items[1].current.buy,0);assert.equal(items[1].buy,-1);assert.equal(items[2].current.buy,null);assert.equal(items[2].current.cash,null);
});
test('missing and zero remain distinct; zero or negative comparison base shows delta without invalid percentage',async()=>{
 const {ctx}=await fixture();assert.equal(vm.runInContext('cv2MarketRate(0,100)',ctx),-1);assert.equal(vm.runInContext('cv2MarketRate(100,0)',ctx),null);assert.equal(vm.runInContext('cv2MarketRate(100,-10)',ctx),null);assert.equal(vm.runInContext('cv2MarketRate(null,100)',ctx),null);
 const html=vm.runInContext('competitorBenchmarkPanel()',ctx);assert.ok(html.includes('前期為 0 · 看差額'));assert.ok(html.includes('-100.0%'));assert.ok(html.includes('同期資料待補'));assert.ok(!html.includes('Infinity'));assert.ok(!html.includes('NaN'));
});
test('selected month, source strings and candidate labels remain safe without mutating data',async()=>{
 const {ctx,data}=await fixture();data.competitors[0].name='<img src=x onerror=boom>';data.marketFundingComparisons.rows[1].sourceFiles=['<script>boom</script>'];const before=JSON.stringify(data),html=vm.runInContext('competitorBenchmarkPanel()',ctx);assert.ok(!html.includes('<img src=x'));assert.ok(!html.includes('<script>boom'));assert.ok(html.includes('&lt;img'));assert.ok(html.includes('候選情境 · 非正式營收'));assert.equal(JSON.stringify(data),before);
 const selected=vm.runInContext("state.month='2026-09';cv2MarketPeriod()",ctx);assert.equal(selected.currentThrough,'2026-09-30');assert.equal(selected.previousThrough,'2026-08-31');assert.equal(vm.runInContext('cv2BenchmarkItems()[0].current.buy',ctx),null);
});
test('archive supplements only matching complete daily cash and independently verified daily activity',async()=>{
 const {ctx,data}=await fixture();data.competitors[0].normalizedDaily=rows('2026-09');data.competitorArchives={platforms:[{platform:'aos',daily:rows('2026-10').map(r=>({date:r[0],officialCash:r[4]})),history:{operatingDaily:rows('2026-10',19).map(r=>({date:r[0],dau:r[1]}))}}]};const x=vm.runInContext('cv2BenchmarkItems()[1]',ctx);assert.equal(x.current.cash,2000);assert.equal(x.current.dau,null);assert.equal(x.cash,0);assert.equal(x.dau,null);
});
test('owned market registration uses exact verified creator-date sources and never retention or cohort totals',async()=>{
 const {ctx,data}=await fixture();data.retention.win=[...rows('2026-09'),...rows('2026-10')];assert.equal(vm.runInContext("cv2OwnNU('win','2026-10',20)",ctx),null);
 data.registrationPeriods=[{platform:'win',from:'2026-10-01',through:'2026-10-20',newRegistered:77,capturedAt:'2026-10-21T01:00:00Z',complete:true,validation:{valid:true}},{platform:'win',from:'2026-10-01',through:'2026-10-19',newRegistered:999,capturedAt:'2026-10-21T02:00:00Z',complete:true,validation:{valid:true}}];assert.equal(vm.runInContext("cv2OwnNU('win','2026-10',20)",ctx),77);data.registrationPeriods[0].validation.valid=false;assert.equal(vm.runInContext("cv2OwnNU('win','2026-10',20)",ctx),null);
});

test('verified daily measures supplement stale competitor aggregates only for their exact dates and individual coverage',async()=>{
 const {ctx,data}=await fixture();data.competitors[0].normalizedDaily=rows('2026-10',19);
 data.marketFundingComparisons.rows[1].dailyMetrics={current:{from:'2026-10-01',through:'2026-10-20',cash:3000,dau:60,cashComplete:true,dauComplete:true}};
 let item=vm.runInContext('cv2BenchmarkItems()[1]',ctx);assert.equal(item.current.cash,3000);assert.equal(item.current.dau,60);
 data.marketFundingComparisons.rows[1].dailyMetrics.current.dauComplete=false;
 item=vm.runInContext('cv2BenchmarkItems()[1]',ctx);assert.equal(item.current.cash,3000);assert.equal(item.current.dau,null);
 data.marketFundingComparisons.rows[1].dailyMetrics.current.through='2026-10-19';
 item=vm.runInContext('cv2BenchmarkItems()[1]',ctx);assert.equal(item.current.cash,null);assert.equal(item.current.dau,null);
});
test('market prefers exact verified 20-day daily metric DTO without upgrading different-period activity',async()=>{
 const {ctx,data}=await fixture();const dm={from:'2026-10-01',through:'2026-10-20',cash:1234,dau:475.75,cashComplete:true,dauComplete:true};data.marketFundingComparisons.rows[1].dailyMetrics={current:dm,previous:{from:'2026-09-01',through:'2026-09-20',cash:2345,dau:580.65,cashComplete:true,dauComplete:true}};let x=vm.runInContext('cv2BenchmarkItems()[1]',ctx);assert.equal(x.current.cash,1234);assert.equal(x.current.dau,475.75);assert.equal(x.previous.dau,580.65);dm.through='2026-10-19';x=vm.runInContext('cv2BenchmarkItems()[1]',ctx);assert.equal(x.current.dau,50);assert.equal(x.current.cash,2000);
});
