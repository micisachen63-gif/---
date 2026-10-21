import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {parseBackendNumber,normalizeDaily,normalizeMonthly,normalizeCompetitor,periodMetrics,buildBackendMetrics} from './backend-metrics.mjs';

const header=['日期','DAU','DPU','總筆數','總金額','儲值率','ARPU','ARPPU','首儲人數','首儲總額'];
test('backend numbers preserve unknowns and zero and parse commas and percentages',()=>{
 for(const value of [null,undefined,'',' ','-','—','－','N/A',NaN,Infinity,true,'12x'])assert.equal(parseBackendNumber(value),null);
 assert.equal(parseBackendNumber('0'),0);assert.equal(parseBackendNumber('1,234.50'),1234.5);assert.equal(parseBackendNumber('9.09%'),9.09);assert.equal(parseBackendNumber('12.3％'),12.3);
});
test('daily normalization uses header names, never positional home-table or summary values',()=>{
 const normalized=normalizeDaily({header:['總金額','日期','儲值率','DAU','DPU','總筆數'],rows:[['100','2026-09-01','10%','20','2','3'],['0','平均','0%','0','0','0']]});
 assert.deepEqual(normalized,[['2026-09-01',20,2,3,100,10,null,null,null,null]]);
 assert.deepEqual(normalizeDaily({header:['時間','創帳數'],rows:[['本月','10']]}),[]);
 assert.throws(()=>normalizeDaily({header,rows:[['2026-09-01'],['2026-09-01']]}),/duplicate/);
});
test('monthly snapshots preserve unique MAU/MPU, ratio and capture-day cutoff independently from daily',()=>{
 const consume={capturedAt:'2026-10-19T19:30:00.000Z',sourceUrl:'https://example.test/month',header:['總金額','日期','MPU','MAU','儲值率','ARPPU'],rows:[['1,000','2026-09','10','100','10.00%','100'],['300','2026-10','3','50','6%','100']]};
 const months=normalizeMonthly('win',consume,null);
 assert.equal(months[0].mau,100);assert.equal(months[0].mpu,10);assert.equal(months[0].payRate,0.1);assert.equal(months[0].firstPayers,null);assert.equal(months[0].through,'2026-09-30');assert.equal(months[0].partial,false);
 assert.equal(months[1].through,'2026-10-20');assert.equal(months[1].partial,true);assert.equal(months[1].deposit,300);assert.equal(months[1].arpu,null);
});
test('matched-day comparisons require all nineteen dates and never turn missing days into zero',()=>{
 const rows=Array.from({length:49},(_,i)=>[new Date(Date.UTC(2026,8,1+i)).toISOString().slice(0,10),10,2,3,100,20,10,50,1,20]);
 const raw={key:'o8',name:'wrong label',capturedAt:'2026-10-20T01:00:00Z',metrics:{september1to19:{newRegistered:40},october1to19:{newRegistered:50}},consumeDaily:{header,rows},gameSummaries:{sep:{units:'遊戲點數'}}};
 const normalized=normalizeCompetitor(raw);
 assert.equal(normalized.name,'發又發');assert.equal(normalized.validation.completeDailyRange,true);assert.equal(normalized.normalizedMetrics.prev.days,19);assert.equal(normalized.normalizedMetrics.current.days,19);assert.equal(normalized.normalizedMetrics.prev.payRate,0.2);assert.equal(normalized.normalizedMetrics.change.cash,0);assert.equal(normalized.normalizedMetrics.change.newRegistered,10);assert.equal(normalized.gameSummaries.sep.units,'遊戲點數');assert.equal(normalized.metrics,raw.metrics);
 const incomplete=normalizeCompetitor({...raw,consumeDaily:{header,rows:rows.slice(1)}});
 assert.equal(incomplete.validation.completeDailyRange,false);assert.equal(incomplete.normalizedMetrics.change.comparable,false);assert.equal(incomplete.normalizedMetrics.change.cash,null);
 const empty=periodMetrics([],'2026-09-01','2026-09-19');assert.equal(empty.cash,null);assert.equal(empty.dau,null);assert.equal(empty.firstPayers,null);
});
test('builder reads available backend snapshots, aliases platform keys, and tolerates unavailable files',async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'backend-metrics-'));
 try{
  await fs.writeFile(path.join(dir,'backend-history-lylucky.json'),JSON.stringify({capturedAt:'2026-10-20T01:00:00Z',consumeMonthly:{header:['日期','MAU','MPU','總金額','儲值率'],rows:[['2026-09','20','4','300','20%']]}}));
  const result=await buildBackendMetrics(dir);assert.equal(result.monthSnapshots.length,1);assert.equal(result.monthSnapshots[0].platform,'lucky');assert.equal(result.monthSnapshots[0].deposit,300);assert.equal(result.monthSnapshots[0].payRate,0.2);assert.deepEqual(result.competitors,[]);
 }finally{await fs.rm(dir,{recursive:true,force:true});}
});
