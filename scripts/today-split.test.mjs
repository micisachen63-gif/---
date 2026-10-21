import test from 'node:test';import assert from 'node:assert/strict';
import {normalizeDaily,splitTodayProgress,normalizeCompetitor,currentTaipeiDay} from './backend-metrics.mjs';
import {backendDailySources,monthlyCoverage,platforms} from './collect-data.mjs';
const header=['日期','DAU','DPU','總筆數','總金額','儲值率','ARPU','ARPPU','首儲人數','首儲總額'];
const row=(date,cash)=>[date,'10','2','3',String(cash),'20%','10','50','1','20'];
test('全年歷史保留至昨日，今日及未來不入完整日報',()=>{
 const raw={capturedAt:'2026-10-20T04:00:00Z',header,rows:[row('2026-01-16',100),row('2026-10-19',200),row('2026-10-20',30),row('2026-10-21',999)]};
 const out=splitTodayProgress(normalizeDaily(raw),{platform:'win',capturedAt:raw.capturedAt,sourceUrl:'https://backend.test'},'2026-10-20');
 assert.deepEqual(out.daily.map(r=>r[0]),['2026-01-16','2026-10-19']);assert.equal(out.daily.reduce((s,r)=>s+r[4],0),300);
 assert.deepEqual(out.todayProgress,{platform:'win',date:'2026-10-20',todayCash:30,dau:10,dpu:2,transactions:3,firstPayers:1,firstCash:20,capturedAt:raw.capturedAt,sourceUrl:'https://backend.test',partial:true});
});
test('無今日來源不捏造進度；真0與未知欄位保留區別',()=>{
 const old=splitTodayProgress(normalizeDaily({header,rows:[row('2026-10-19',10)]}),{platform:'win'},'2026-10-20');assert.equal(old.todayProgress,null);
 const zero=splitTodayProgress([],{platform:'win',dailyToday:{date:'2026-10-20',todayCash:0,dau:null,dpu:0,transactions:0,firstPayers:0,firstCash:0,capturedAt:'2026-10-20T04:00:00Z'}},'2026-10-20');assert.equal(zero.todayProgress.todayCash,0);assert.equal(zero.todayProgress.dau,null);
 assert.equal(splitTodayProgress([],{dailyToday:{date:'2026-10-19',todayCash:99}},'2026-10-20').todayProgress,null);
});
test('競品全年日報今日分離，固定同期比較仍只計1–19日',()=>{
 const rows=Array.from({length:293},(_,i)=>row(new Date(Date.UTC(2026,0,i+1)).toISOString().slice(0,10),100));
 const raw={key:'fcc',capturedAt:'2026-10-20T01:00:00Z',consumeDaily:{header,rows},consumeMonthly:{header:['日期','MAU','MPU','總金額'],rows:[['2026-10','100','10','2000']]}};
 const c=normalizeCompetitor(raw,{today:'2026-10-20'});assert.equal(c.normalizedDaily.length,292);assert.equal(c.normalizedDaily.at(-1)[0],'2026-10-19');assert.equal(c.todayProgress.todayCash,100);assert.equal(c.normalizedMetrics.current.cash,1900);assert.equal(c.normalizedMonthly[0].through,'2026-10-20');assert.equal(raw.consumeDaily.rows.length,293);
});
test('跨日重建不把來源採集當日的半日數字升成完整日，也不偽造今日進度',()=>{
 const rows=normalizeDaily({header,rows:[row('2026-10-19',200),row('2026-10-20',30)]}),metadata={platform:'fcc',capturedAt:'2026-10-20T15:59:00Z'};
 for(const buildDate of ['2026-10-21','2026-10-22']){const out=splitTodayProgress(rows,metadata,buildDate);assert.deepEqual(out.daily.map(r=>r[0]),['2026-10-19']);assert.equal(out.todayProgress,null);assert.equal(out.coverage.captureDate,'2026-10-20');assert.deepEqual(out.coverage.excludedUnclosedDates,['2026-10-20']);}
});
test('只有次日實際重抓的來源可讓前日進入完整日，台灣午夜邊界精確',()=>{
 const rows=normalizeDaily({header,rows:[row('2026-10-19',200),row('2026-10-20',300),row('2026-10-21',0)]});
 const before=splitTodayProgress(rows,{capturedAt:'2026-10-20T15:59:59Z'},'2026-10-21');assert.deepEqual(before.daily.map(r=>r[0]),['2026-10-19']);assert.equal(before.todayProgress,null);
 const fresh=splitTodayProgress(rows,{capturedAt:'2026-10-20T16:00:00Z'},'2026-10-21');assert.deepEqual(fresh.daily.map(r=>r[0]),['2026-10-19','2026-10-20']);assert.equal(fresh.daily.at(-1)[4],300);assert.equal(fresh.todayProgress.todayCash,0);
});
test('來源時間缺漏或無效不能靠系統日推定完整，raw不被改寫',()=>{
 const rows=normalizeDaily({header,rows:[row('2026-10-19',200),row('2026-10-21',0)]}),copy=structuredClone(rows);
 for(const capturedAt of [null,undefined,'not-a-time']){const out=splitTodayProgress(rows,{capturedAt},'2026-10-21');assert.equal(out.daily.length,0);assert.equal(out.todayProgress,null);assert.equal(out.coverage.captureTimeKnown,false);assert.deepEqual(out.coverage.excludedUnclosedDates,['2026-10-19']);}assert.deepEqual(rows,copy);
});
test('競品容器被更新不會洗新consume來源時間，跨日同比仍截至19日',()=>{
 const rows=Array.from({length:293},(_,i)=>row(new Date(Date.UTC(2026,0,i+1)).toISOString().slice(0,10),100));
 const c=normalizeCompetitor({key:'fcc',capturedAt:'2026-10-21T01:00:00Z',consumeDaily:{capturedAt:'2026-10-20T11:00:00Z',header,rows}},{today:'2026-10-21'});
 assert.equal(c.normalizedDaily.length,292);assert.equal(c.normalizedDaily.at(-1)[0],'2026-10-19');assert.equal(c.todayProgress,null);assert.equal(c.normalizedMetrics.current.cash,1900);assert.deepEqual(c.dailyClosureCoverage.excludedUnclosedDates,['2026-10-20']);
});
test('collector兩條raw來源各自依採集日過濾，舊未結不能靠另一來源的時間升級',()=>{
 const raw={capturedAt:'2026-10-21T01:00:00Z',dailyCapturedAt:'2026-10-20T01:00:00Z',daily:[['2026-10-19',1,1,1,100],['2026-10-20',1,1,1,9]],consumeDaily:{capturedAt:'2026-10-20T16:00:00Z',header,rows:[row('2026-10-19',100),row('2026-10-20',200),row('2026-10-21',0)]}};
 const [old,fresh]=backendDailySources(raw).map(s=>splitTodayProgress(s.rows,s,'2026-10-21'));
 assert.deepEqual(old.daily.map(r=>r[0]),['2026-10-19']);assert.deepEqual(fresh.daily.map(r=>r[0]),['2026-10-19','2026-10-20']);assert.equal(fresh.daily.at(-1)[4],200);
});
test('collector可從consumeDaily讀新全年來源，與既有daily並存，日期採台灣時區',()=>{
 const sources=backendDailySources({capturedAt:'2026-10-20T00:00:00Z',daily:[['2026-09-01',1,1,1,100]],consumeDaily:{capturedAt:'2026-10-20T01:00:00Z',header,rows:[row('2026-01-01',10),row('2026-10-20',20)]}});
 assert.equal(sources.length,2);assert.equal(sources[1].rows[0][0],'2026-01-01');assert.equal(sources[1].rows.at(-1)[0],'2026-10-20');assert.equal(sources[1].capturedAt,'2026-10-20T01:00:00Z');
 assert.equal(currentTaipeiDay(new Date('2026-10-19T16:00:00Z')),'2026-10-20');
});
test('Win開服日以前不算missing；一月14筆只欠17/18兩個實際營運日',()=>{
 const win=platforms.find(p=>p.key==='win');assert.equal(win.launchDate,'2026-01-16');assert.equal(win.launchDateSource,'使用者提供');
 const dates=Array.from({length:16},(_,i)=>'2026-01-'+String(i+16)).filter(d=>!['2026-01-17','2026-01-18'].includes(d));
 const coverage=monthlyCoverage(win,'2026-01',dates,'2026-10-20');assert.equal(coverage.expectedDays,16);assert.deepEqual(coverage.missingDates,['2026-01-17','2026-01-18']);assert.equal(coverage.complete,false);assert.equal(coverage.expectedFrom,'2026-01-16');
 assert.equal(monthlyCoverage(win,'2026-01',[...dates,'2026-01-17','2026-01-18'],'2026-10-20').complete,true);
 assert.equal(monthlyCoverage(platforms.find(p=>p.key==='qz'),'2026-01',dates,'2026-10-20').expectedDays,31);
});
