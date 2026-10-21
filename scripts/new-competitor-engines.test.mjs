import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {buildCompetitorFunding,COMPETITOR_SCENARIO_ROSTER} from './competitor-funding.mjs';
import {buildCompetitorArchives} from './competitor-archive.mjs';
import {buildMarketFundingComparisons} from './market-funding-comparisons.mjs';
import {buildMarketDailyComparisons} from './market-daily-comparisons.mjs';
const sites={goldfun:'admin.goldfun88.com:9955',o9:'admin.o9play.com:9955'},asOf='2026-10-21',period={previousFrom:'2026-09-01',previousThrough:'2026-09-20',currentFrom:'2026-10-01',currentThrough:'2026-10-20'},policy={method:'coins/divisor',rates:Object.fromEntries(Object.keys(sites).map(k=>[k,{buyDivisor:130,sellDivisor:144}]))};
async function fixture(t){const dir=await fs.mkdtemp(path.join(os.tmpdir(),'new-comp-')),files=[];t.after(async()=>{for(const file of files)await fs.unlink(path.join(dir,file));await fs.rmdir(dir);});const save=async(file,data)=>{await fs.writeFile(path.join(dir,file),JSON.stringify(data));files.push(file);};
 for(const [platform,host] of Object.entries(sites))for(const month of ['2026-09','2026-10']){const from=month+'-01',through=month+'-20',queryProof={selectedFrom:from,selectedThrough:through,verified:true},capturedAt='2026-10-21T01:00:00Z';
  await save(`competitor-cash-range-${platform}-${from}_${through}.json`,{platform,from,through,capturedAt,sourceUrl:`https://${host}/statements/player-summary`,tab:'玩家消費',header:['日期','DAU','DPU','總筆數','總金額','儲值率','ARPU','ARPPU','首儲人數','首儲總額'],rows:Array.from({length:20},(_,i)=>[month+'-'+String(i+1).padStart(2,'0'),10,2,3,month==='2026-10'?20:10,'20%',2,10,1,1]),complete:true,queryProof});
  await save(`competitor-period-rank-${platform}-${from}_${through}.json`,{platform,from,through,capturedAt,sourceUrl:`https://${host}/statements/giving`,tab:'贈禮排行',header:['名次','贈禮AID','贈禮暱稱','對象AID','對象暱稱','贈禮總金額','差額'],rows:[['1','x','X','y','Y','1300','1300']],totalRows:1,complete:true,currentDayPartial:false,recentOnlyRestriction:false,queryProof,paginationProof:{pageSize:1000,totalRows:1,pages:[{page:1,rowCount:1,firstRank:'1',lastRank:'1'}]}});
 }
 return dir;
}
test('new sites retain independent cash/DAU while complete pair sources cannot turn missing identities into zero',async t=>{
 const dir=await fixture(t),funding=await buildCompetitorFunding(dir,{competitors:[],policy,asOf,currentPeriod:{from:period.currentFrom,through:period.currentThrough}}),archives=await buildCompetitorArchives(dir,{competitors:[],policy,asOf}),market=buildMarketFundingComparisons({competitorFundingScenarios:funding,policy,period}),daily=await buildMarketDailyComparisons(dir,{period,today:asOf});
 assert.equal(funding.platforms.length,6);assert.equal(archives.platforms.length,6);assert.equal(Object.values(COMPETITOR_SCENARIO_ROSTER).reduce((n,r)=>n+r.length,0),22);
 for(const key of Object.keys(sites)){
  const f=funding.platforms.find(p=>p.platform===key);assert.equal(f.status,'missing_roster');assert.equal(f.includedMerchants.length,0);assert.equal(f.current.source.complete,true);assert.equal(f.current.covered,false);assert.equal(f.current.buyCoins,null);assert.equal(f.current.sellCoins,null);assert.equal(f.current.scenarioRevenue,null);assert.equal(f.current.officialCash,400);assert.equal(f.change.cashComparable,true);assert.equal(f.change.officialCash,200);assert(f.current.validation.issues.includes('scenario_roster_missing'));assert.equal(f.includeInActualRevenue,false);
  const a=archives.platforms.find(p=>p.platform===key),m=a.monthly.find(m=>m.month==='2026-10');assert.equal(a.identityStatus,'missing_roster');assert.equal(a.rates.buyDivisor,130);assert.equal(a.rates.sellDivisor,144);assert.equal(m.monthRank.covered,false);assert(m.monthRank.validation.issues.includes('scenario_roster_missing'));assert.equal(m.buyCoins,null);assert.equal(m.sellCoins,null);assert.equal(m.scenarioRevenue,null);assert.equal(m.officialCash,400);assert.equal(a.daily.at(-1).covered,false);
  const row=market.rows.find(r=>r.platform===key);assert.equal(row.covered,false);assert.equal(row.buyAmount,null);assert.equal(row.prevSellAmount,null);assert.equal(row.includeInActualRevenue,false);
  const metric=daily.rows.find(r=>r.platform===key);assert.equal(metric.current.cash,400);assert.equal(metric.previous.cash,200);assert.equal(metric.current.dau,10);assert.equal(metric.current.dauComplete,true);assert(metric.current.sourceFiles.every(f=>f.includes(key)));
 }
});
test('new shells with no raw data preserve null values for all financial fields',async t=>{const dir=await fs.mkdtemp(path.join(os.tmpdir(),'empty-comp-'));t.after(()=>fs.rmdir(dir));const out=await buildCompetitorFunding(dir,{competitors:[{key:'goldfun',name:'金來快',url:'https://admin.goldfun88.com:9955/'}],policy,asOf});const p=out.platforms.find(p=>p.platform==='goldfun');assert.equal(p.current.officialCash,null);assert.equal(p.current.buyCoins,null);assert.equal(p.current.scenarioRevenue,null);assert.equal(p.current.covered,false);});
