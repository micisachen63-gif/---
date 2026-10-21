import test from 'node:test';import assert from 'node:assert/strict';
import {validateFreshTable,mergeHistory} from './collect-dashboard-readonly.mjs';
import {normalizeDaily,splitTodayProgress} from './backend-metrics.mjs';
const header=['日期','DAU','DPU','總筆數','總金額','儲值率','ARPU','ARPPU','首儲人數','首儲總額'];
const row=(day,cash)=>[day,'2','1','1',cash,'50%','5','10','1','10'];
const opts={header,from:'2026-10-18',to:'2026-10-20',partialToday:'2026-10-20',completeThrough:'2026-10-19'};
test('手動查詢包含今日，但完整日缺漏只驗證到昨日',()=>{
 const result=validateFreshTable([header,row('2026-10-18','100'),row('2026-10-19','200'),row('2026-10-20','30'),['加總','','','','330']],opts);
 assert.equal(result.completeThrough,'2026-10-19');assert.equal(result.todayPresent,true);assert.equal(result.cash,330);
 const split=splitTodayProgress(normalizeDaily({header,rows:result.rows}),{platform:'win',capturedAt:'2026-10-20T04:00:00Z'},'2026-10-20');assert.equal(split.daily.reduce((s,r)=>s+r[4],0),300);assert.equal(split.todayProgress.todayCash,30);
 assert.throws(()=>validateFreshTable([header,row('2026-10-18','100'),row('2026-10-20','30')],opts),/起迄日|缺日/);
});
test('今日缺列與金額空白保持未知，真0保持0',()=>{
 const missing=validateFreshTable([header,row('2026-10-18','100'),row('2026-10-19','200')],opts);assert.equal(missing.todayPresent,false);assert.equal(splitTodayProgress(normalizeDaily({header,rows:missing.rows}),{capturedAt:'2026-10-20T04:00:00Z'},'2026-10-20').todayProgress,null);
 const empty=validateFreshTable([header,row('2026-10-18','100'),row('2026-10-19','200'),row('2026-10-20','')],opts);assert.equal(empty.cash,null);assert.equal(splitTodayProgress(normalizeDaily({header,rows:empty.rows}),{capturedAt:'2026-10-20T04:00:00Z'},'2026-10-20').todayProgress.todayCash,null);
 const zero=validateFreshTable([header,row('2026-10-18','100'),row('2026-10-19','200'),row('2026-10-20','0')],opts);assert.equal(splitTodayProgress(normalizeDaily({header,rows:zero.rows}),{capturedAt:'2026-10-20T04:00:00Z'},'2026-10-20').todayProgress.todayCash,0);
});
test('合併保留全年raw與新schema，不把上次今日列換時間當新資料',()=>{
 const prior={daily:[['2026-01-16',1],['2026-10-20',9]],consumeDaily:{header,rows:[row('2026-01-16','10'),row('2026-10-18','1'),row('2026-10-19','2'),row('2026-10-20','999')]},machines:{sentinel:true},merchantCandidates:{sentinel:true},coinConversion:{sentinel:true}};
 const fresh={from:'2026-10-18',to:'2026-10-20',header,rows:[row('2026-10-18','100'),row('2026-10-19','200')]};
 const out=mergeHistory(prior,{consumeDaily:fresh,daily:[['2026-10-18',2],['2026-10-19',3]],dailyToday:null,completeThrough:'2026-10-19'});
 assert.deepEqual(out.consumeDaily.rows.map(r=>r[0]),['2026-01-16','2026-10-18','2026-10-19']);assert.equal(out.daily.some(r=>r[0]==='2026-10-20'),false);assert.equal(out.consumeDaily.queriedThrough,'2026-10-20');assert.equal(out.consumeDaily.to,'2026-10-19');assert.equal(out.dailyToday,null);assert.deepEqual(out.machines,prior.machines);assert.deepEqual(out.merchantCandidates,prior.merchantCandidates);assert.deepEqual(out.coinConversion,prior.coinConversion);
});
