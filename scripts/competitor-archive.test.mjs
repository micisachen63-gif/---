// LEGACY_RATE_FIXTURE: injected 133/144 or alternate divisors test historical/custom DTO compatibility; current production rates come only from merchant-rates.json.
import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs/promises';import os from 'node:os';import path from 'node:path';
import {parseArchiveDailySource,parseArchiveGiftSummary,parseArchiveOperatingSource,parseArchiveRegistration,analyzeCompetitorArchive,buildCompetitorArchive} from './competitor-archive.mjs';
const HEADER=['名次','贈禮AID','贈禮暱稱','對象AID','對象暱稱','贈禮總金額','差額'],GIFT_HEADER=['日期','新贈禮總金額','新總手續費','總贈禮人數','總收禮人數','總贈禮筆數','成功贈禮筆數'];
const POLICY={method:'coins/divisor',rates:{o8:{buyDivisor:133,sellDivisor:144}}},MODEL={platforms:[{platform:'o8',includedMerchants:[{aid:'m1',nickname:'hypothesis',verified:false},{aid:'m2',nickname:'other hypothesis',verified:false}],excludedRoles:[{aid:'streamer',role:'直播主',status:'user_confirmed_streamer_role',excludeFromScenario:true}]}]};
const opts={asOf:'2026-10-21',policy:POLICY,fundingScenarios:MODEL};
function daily(date='2026-10-20',edges=[['m1','p',133],['p','m1',144]],capturedAt='2026-10-21T01:00:00Z',explicit=true){const values=new Map(edges.map(([a,b,n])=>[JSON.stringify([a,b]),n])),rows=edges.map(([a,b,n],i)=>[String(i+1),a,'name '+a,b,'name '+b,String(n),String(n-(values.get(JSON.stringify([b,a]))??0))]);return{file:`gift-daily-rank-o8-${date}.json`,data:{platform:'o8',from:date,through:date,capturedAt,sourceUrl:'https://admin.8o8.tw:9955/statements/giving',tab:'贈禮排行',header:HEADER,rows,totalRows:rows.length,complete:true,currentDayPartial:false,queryProof:{selectedFrom:date,selectedThrough:date,verified:true},...(explicit?{paginationProof:{pageSize:1000,totalRows:rows.length,pages:[{page:1,rowCount:rows.length,firstRank:rows.length?'1':null,lastRank:rows.length?String(rows.length):null}]}}:{})}};}
function cashRows(from='2026-01-01',through='2026-10-20',amount=10){const rows=[];for(let t=Date.parse(from);t<=Date.parse(through);t+=86400000)rows.push([new Date(t).toISOString().slice(0,10),1,1,1,amount]);return[{file:'cash.json',capturedAt:'2026-10-21T01:00:00Z',sourceUrl:'https://admin.8o8.tw:9955/statements/player-summary',rows}];}
const run=(reports,extra={})=>analyzeCompetitorArchive(reports,{...opts,cashSources:cashRows(),...extra});
function gift({monthly=false}={}){return{platform:'o8',from:monthly?'2026-01':'2026-01-01',through:monthly?'2026-10':'2026-01-02',capturedAt:'2026-10-21T01:00:00Z',sourceUrl:'https://admin.8o8.tw:9955/statements/giving',tab:monthly?'月報表':'日報表',header:GIFT_HEADER,rows:monthly?[['2026-01','100','1','2','3','4','4'],['2026-10','500','5','6','7','8','8']]:[['2026-01-01','30','1','2','3','4','4'],['2026-01-02','40','2','3','4','5','5']],complete:true,currentMonthPartial:monthly,queryProof:{selectedFrom:monthly?'2026-01':'2026-01-01',selectedThrough:monthly?'2026-10':'2026-01-02',verified:true}};}

test('seven closed dates deduplicate all versions and overlapping week files are never summed',()=>{
 const reports=Array.from({length:7},(_,i)=>daily('2026-10-'+String(14+i))),version=structuredClone(reports[6]);version.file='competitor-archive/o8/daily/2026-10-20/hash.json';reports.push(version);
 const original=structuredClone(reports),x=run(reports);assert.equal(x.recentWindow.coveredDays,7);assert.equal(x.recentWindow.summary.buyCoins,7*133);assert.equal(x.recentWindow.summary.sellCoins,7*144);assert.equal(x.recentWindow.summary.officialCash,70);assert.equal(x.recentWindow.summary.scenarioRevenue,70);assert.equal(x.recentWindow.comparison.comparable,false);assert.equal(x.officialRevenue,null);assert.equal(x.includeInActualRevenue,false);assert.deepEqual(reports,original);
});
test('legacy single-page evidence is explicit and bounded, with old capture time preserved',()=>{
 const legacy=daily('2026-10-14',[['m1','p',133]],'2026-10-20T13:47:09Z',false),p=parseArchiveDailySource(legacy.file,legacy.data,opts);assert.equal(p.complete,true);assert.equal(p.paginationProof,null);assert.equal(p.paginationValidation.mode,'legacy_single_page_total_rows');assert.equal(p.paginationValidation.selectedPageProofAvailable,false);
 const fresh=daily('2026-10-15',[['m1','p',133]],'2026-10-21T01:00:00Z',false);assert.equal(parseArchiveDailySource(fresh.file,fresh.data,opts).complete,false);
 const x=run([legacy,daily('2026-10-15')]);assert.equal(x.recentWindow.mixedCapture,true);assert.equal(x.daily.find(r=>r.date==='2026-10-14').capturedAt,legacy.data.capturedAt);
});
test('invalid latest version never replaces valid history; conflicting same-capture values are quarantined',()=>{
 const old=daily('2026-10-19',[['m1','p',133]],'2026-10-20T13:00:00Z'),bad=daily('2026-10-19',[['m1','p',266]]);bad.data.queryProof.verified=false;
 let x=run([old,bad]);assert.equal(x.daily.find(r=>r.date==='2026-10-19').buyCoins,133);assert.equal(x.rejectedSources.length,1);
 const a=daily('2026-10-19',[['m1','p',266]]),b=daily('2026-10-19',[['m1','p',399]]);b.file='competitor-archive/o8/daily/2026-10-19/other.json';x=run([old,a,b]);assert.equal(x.daily.find(r=>r.date==='2026-10-19').buyCoins,133);assert.equal(x.snapshotConflicts.length,1);
});
test('current or previously partial capture, wrong dates, missing pagination and incomplete rows stay unknown',()=>{
 const base=daily();for(const mutate of [s=>{s.data.capturedAt='2026-10-20T12:00:00Z';},s=>{s.data.currentDayPartial=true;},s=>{s.data.queryProof.selectedFrom='2026-10-19';},s=>{delete s.data.paginationProof;},s=>{s.data.complete=false;},s=>{s.data.paginationProof.totalRows=1001;},s=>{s.data.rows[0][6]='133';}]){const s=structuredClone(base);mutate(s);const x=run([s]),r=x.daily.at(-1);assert.equal(r.covered,false);assert.equal(r.buyCoins,null);assert.equal(r.scenarioRevenue,null);assert.equal(r.officialCash,10);}
});
test('complete empty date is zero, absent date null, gaps exact and partial month is never fabricated',()=>{
 const x=run([daily('2026-10-20',[])]),oct=x.monthly.find(m=>m.month==='2026-10');assert.equal(x.daily.at(-1).buyCoins,0);assert.equal(x.daily.at(-2).buyCoins,null);assert.equal(oct.buyCoins,null);assert.equal(oct.officialCash,200);assert.equal(oct.observed.buyCoins,0);assert.equal(oct.missingDates.length,19);assert.ok(oct.missingDates.includes('2026-10-01'));assert.equal(x.coverage.merchant.months[0].missingDates.length,31);
});
test('merchant internal and excluded streamer role flows do not inflate buys or sells',()=>{
 const x=run([daily('2026-10-20',[['m1','m2',1000],['m2','m1',500],['m1','streamer',100],['streamer','m1',50],['m1','p',133],['p','m1',144]])]),r=x.daily.at(-1);assert.equal(r.buyCoins,133);assert.equal(r.sellCoins,144);assert.equal(r.excludedInternalCoins,1500);assert.equal(r.excludedRoleCoins,150);assert.equal(r.scenarioRevenue,10);assert.equal(x.excludedRoles[0].status,'user_confirmed_streamer_role');
});
test('global gift history remains its own total and current monthly snapshot keeps original unclosed cutoff',()=>{
 const d=gift(),m=gift({monthly:true}),x=run([],{giftSummaries:[{file:'global#daily',data:d},{file:'global#monthly',data:m}]});
 assert.equal(x.history.daily.length,2);assert.equal(x.history.daily[0].totalGiftCoins,30);assert.equal(x.history.daily[0].givenCoins,null);assert.equal(x.history.daily[0].receivedCoins,null);assert.equal(x.history.monthly[0].complete,true);assert.equal(x.history.monthly[1].through,'2026-10-21');assert.equal(x.history.monthly[1].partial,true);assert.equal(x.coverage.globalGift.monthly.coveredMonths.includes('2026-10'),false);assert.equal(x.daily[0].buyCoins,null);
 d.queryProof.verified=false;assert.equal(parseArchiveGiftSummary('global',d,opts).complete,false);
});
test('schedule reports actual configuration and last source capture separately from generation',()=>{
 const x=run([daily()]);assert.equal(x.schedule.configured,false);assert.equal(x.schedule.status,'not_configured');assert.equal(x.schedule.lastSuccessfulCaptureAt,null);assert.equal(x.schedule.sourceUpdatedAt,'2026-10-21T01:00:00Z');
 const failed=run([],{schedule:{configured:true,status:'login_required',lastAttemptAt:'2026-10-21T00:00:00Z',loginExpired:true,error:'login required'}});assert.equal(failed.schedule.status,'login_required');assert.equal(failed.schedule.loginExpired,true);assert.equal(failed.schedule.lastSuccessfulCaptureAt,null);
});
test('cash is retained throughout full year without merchant observations, stale capture cannot close its own date',()=>{
 const x=run([]);assert.equal(x.daily.length,293);assert.equal(x.coverage.cash.coveredDates.length,293);assert.equal(x.daily[0].officialCash,10);assert.equal(x.daily[0].buyCoins,null);
 const sources=cashRows();sources[0].capturedAt='2026-10-20T12:00:00Z';const stale=run([],{cashSources:sources});assert.equal(stale.daily.at(-1).officialCash,null);assert.equal(stale.coverage.cash.missingDates.at(-1),'2026-10-20');
});
test('activity and welfare aggregate events and DAU mean, never claim monthly unique members',()=>{
 const shared={from:'2026-10-01',to:'2026-10-20',capturedAt:'2026-10-21T01:00:00Z',sourceUrl:'https://admin.8o8.tw:9955/statements/player-summary',complete:true,queryProof:{selectedFrom:'2026-10-01',selectedThrough:'2026-10-20',verified:true}},date=i=>'2026-10-'+String(i+1).padStart(2,'0');
 const active={...shared,header:['日期','DAU','登入次數','在線時數'],rows:Array.from({length:20},(_,i)=>[date(i),10,30,2])},benefits={...shared,header:['日期','領取發財金次數','領取發財金總額','手機驗證','加入官方Line帳號'],rows:Array.from({length:20},(_,i)=>[date(i),2,133,1,0])};
 const x=run([],{operatingSources:[{file:'active',data:active,kind:'active'},{file:'benefits',data:benefits,kind:'benefits'}]}),m=x.history.operatingMonthly.at(-1);assert.equal(m.averageDAU,10);assert.equal(m.loginEvents,600);assert.equal(m.onlineHours,40);assert.equal(m.fortuneClaimCoins,2660);assert.equal(m.fortuneClaimEvents,40);assert.equal(m.mobileVerificationEvents,20);assert.equal(m.lineVerificationEvents,0);assert.equal(m.activeCoveredDays,20);assert.equal(m.benefitCoveredDays,20);assert.equal(m.mau,undefined);assert.match(m.definition,/不是月去重/);
 benefits.rows.pop();const partial=run([],{operatingSources:[{file:'benefits',data:benefits,kind:'benefits'}]}).history.operatingMonthly.at(-1);assert.equal(partial.fortuneClaimCoins,null);assert.deepEqual(partial.benefitMissingDates,['2026-10-20']);assert.equal(parseArchiveOperatingSource('bad',{...active,queryProof:{}},'active',opts).complete,false);
});
test('registration month uses verified creation-date count only, never cohort cumulative money',()=>{
 const d={period:{from:'2026-10-01',to:'2026-10-20'},newRegistered:25,capturedAt:'2026-10-21T01:00:00Z',sourceUrl:'https://admin.8o8.tw:9955/statements/player-view',queryProof:{selectedFrom:'2026-10-01',selectedThrough:'2026-10-20',verified:true},registrationTable:[['','創建帳號','儲值總額'],['All','25','999999']]},p=parseArchiveRegistration('registrations',d,opts);assert.equal(p.complete,true);assert.equal(p.registration,25);
 const x=run([],{registrationSources:[{file:'registrations',data:d}]}),m=x.history.operatingMonthly.at(-1);assert.equal(m.registration,25);assert.equal(m.officialCash,200);assert.equal(m.registrationPeriodComplete,true);assert.match(m.registrationSource.definition,/不是當月交易/);
 d.newRegistered=26;assert.equal(parseArchiveRegistration('bad',d,opts).registration,null);
});
test('builder only reads daily provenance, ignores overlapping weekly raw and preserves immutable history without writes',async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'competitor-archive-')),s=daily(),folder=path.join(dir,'competitor-archive/o8/daily/2026-10-20'),immutable=path.join(folder,'capture-hash.json'),old='gift-network-week-o8-2026-10-14_2026-10-20.json';
 try{await fs.mkdir(folder,{recursive:true});await fs.writeFile(path.join(dir,s.file),JSON.stringify(s.data));await fs.writeFile(immutable,JSON.stringify(s.data));await fs.writeFile(path.join(dir,old),'not read');const result=await buildCompetitorArchive(dir,{...opts,competitors:[]});assert.equal(result.daily.at(-1).buyCoins,133);assert.equal(result.recentWindow.coveredDays,1);assert.equal(result.sourceReadErrors.length,0);assert.equal((await fs.readdir(folder)).length,1);
 }finally{await fs.unlink(path.join(dir,s.file));await fs.unlink(path.join(dir,old));await fs.unlink(immutable);await fs.rmdir(folder);await fs.rmdir(path.dirname(folder));await fs.rmdir(path.dirname(path.dirname(folder)));await fs.rmdir(path.dirname(path.dirname(path.dirname(folder))));await fs.rmdir(dir);}
});
