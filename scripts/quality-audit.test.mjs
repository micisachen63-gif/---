import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {qualityDates,inspectRanking,inspectMachine,buildQualityAudit} from './quality-audit.mjs';

const context={today:'2000-02-03',year:'2000',launchDates:{}};
const ref=dates=>({rows:dates.map(date=>({date,cash:10})),kind:'test'});
const rank=(extra={})=>({platform:'qz',period:{from:'2000-02-01',to:'2000-02-02'},complete:true,capturedAt:'2000-02-03T01:00:00Z',header:['名次','AID','暱稱','儲值金額'],rows:[['1','never-print-this-aid','never-print-this-nickname','20']],validation:{rankingDeposit:20,dailyDeposit:20,matching:true},...extra});
const filename='deposit-ranking-qz-2000-02.json';
const machine=(extra={})=>({platform:'bo',from:'2000-02-01',through:'2000-02-03',queryThrough:'2000-02-29',partial:true,capturedAt:'2000-02-03T01:00:00Z',header:['廠商名稱','機台名稱','不重複玩家數','投注筆數','總投注額','有效投注額','總出分','遊戲淨利','RTP','淨利表','活動加贈'],rows:[['Vendor','Game','2','50','100','100','90','10','90%','10%','0'],['加總','50','100','100','90','10','90%','10%','0']],validation:{complete:true,valid:true},...extra});
const codes=result=>result.issues.map(i=>i.code);

test('rank schema, independent cash range and optional metadata reconcile without emitting PII',()=>{
 const r=inspectRanking(filename,rank(),ref(['2000-02-01','2000-02-02']),context);assert.equal(r.sourceComplete,true);assert.equal(r.periodValid,true);assert.equal(r.cashComparison.matching,true);assert.equal(r.acceptedForExactCashComparison,true);assert.equal(r.currentMonthPartial,true);assert.equal(r.todayPartial,false);assert.doesNotMatch(JSON.stringify(r),/never-print-this-aid|never-print-this-nickname/);
});
test('matching reported totals do not fill a missing daily date with zero',()=>{
 const r=inspectRanking(filename,rank(),ref(['2000-02-01']),context);assert.equal(r.cashComparison.cash,null);assert.equal(r.cashComparison.matching,null);assert.equal(r.acceptedForExactCashComparison,false);assert.deepEqual(r.cashComparison.missingDates,['2000-02-02']);assert.ok(codes(r).includes('ranking_daily_reference_incomplete'));
});
test('cash mismatch, duplicate AID, missing columns and wrong key are independently flagged',()=>{
 let r=inspectRanking(filename,rank({rows:[['1','one','Name',21]]}),ref(['2000-02-01','2000-02-02']),context);assert.ok(codes(r).includes('ranking_vs_daily_cash_mismatch'));assert.ok(codes(r).includes('ranking_metadata_total_mismatch'));
 r=inspectRanking(filename,rank({rows:[['1','same','A',10],['2','same','B',10]]}),ref(['2000-02-01','2000-02-02']),context);assert.ok(codes(r).includes('ranking_duplicate_aid'));assert.doesNotMatch(JSON.stringify(r),/"same"|"A"|"B"/);
 for(const d of [rank({header:['名次','AID','儲值金額']}),rank({platform:'song'}),rank({rows:[['1','aid','Name','10%']]})])assert.equal(inspectRanking(filename,d,ref(['2000-02-01','2000-02-02']),context).acceptedForExactCashComparison,false);
});
test('unreconciled snapshots keep platform, month and cash difference but are quarantined from canonical coverage',()=>{
 const r=inspectRanking('deposit-ranking-qz-2000-02-unreconciled.json',rank({complete:false,rows:[['1','secret-aid','secret-name',21]],validation:{matching:false}}),ref(['2000-02-01','2000-02-02']),context);
 assert.equal(r.platform,'qz');assert.equal(r.month,'2000-02');assert.equal(r.quarantined,true);assert.equal(r.canonical,false);assert.equal(r.rankingCash,21);assert.equal(r.cashComparison.delta,1);assert.equal(r.acceptedForExactCashComparison,false);assert.ok(codes(r).includes('quarantined_unreconciled_source'));assert.ok(codes(r).includes('ranking_vs_daily_cash_mismatch'));assert.equal(codes(r).includes('unsupported_ranking_filename'),false);assert.doesNotMatch(JSON.stringify(r),/secret-aid|secret-name/);
});
test('incomplete, today-partial and capture-date violations remain distinct',()=>{
 let r=inspectRanking(filename,rank({complete:false}),ref(['2000-02-01','2000-02-02']),context);assert.equal(r.completenessStatus,'incomplete');assert.equal(r.todayPartial,false);assert.ok(codes(r).includes('ranking_incomplete'));
 r=inspectRanking(filename,rank({period:{from:'2000-02-01',to:'2000-02-03'},rows:[['1','aid','Name',30]],validation:{matching:true}}),ref(['2000-02-01','2000-02-02','2000-02-03']),context);assert.equal(r.cashComparison.matching,true);assert.equal(r.todayPartial,true);assert.equal(r.acceptedForExactCashComparison,false);
 r=inspectRanking(filename,rank({period:{from:'2000-02-01',to:'2000-02-04'}}),ref([]),context);assert.ok(codes(r).includes('ranking_through_after_capture'));assert.equal(r.periodValid,false);
});
test('launch date excludes only pre-launch reference dates; missing launched dates remain unknown',()=>{
 const c={today:'2000-02-03',year:'2000',launchDates:{win:'2000-01-16'}},d=rank({platform:'win',period:{from:'2000-01-01',to:'2000-01-31'},rows:[['1','aid','Name',160]],validation:{matching:true}}),reference=ref(qualityDates('2000-01-16','2000-01-31'));
 let r=inspectRanking('deposit-ranking-win-2000-01.json',d,reference,c);assert.equal(r.cashComparison.matching,true);assert.equal(r.cashComparison.effectiveFrom,'2000-01-16');reference.rows=reference.rows.filter(r=>r.date!=='2000-01-17');r=inspectRanking('deposit-ranking-win-2000-01.json',d,reference,c);assert.equal(r.cashComparison.matching,null);assert.deepEqual(r.cashComparison.missingDates,['2000-01-17']);
});
test('machine queryThrough may reach month end but actual through may not exceed Taipei capture',()=>{
 let r=inspectMachine('machine-bo-2000-02.json',machine(),context);assert.equal(r.valid,true);assert.equal(r.totalsMatch,true);assert.equal(r.todayPartial,true);assert.equal(r.periodValid,true);
 r=inspectMachine('machine-bo-2000-02.json',machine({through:'2000-02-04'}),context);assert.equal(r.totalsMatch,true);assert.equal(r.valid,false);assert.ok(codes(r).includes('machine_through_after_capture'));
});
test('machine source invalid warning survives exact sums; malformed metadata does not crash auditing',()=>{
 const r=inspectMachine('machine-bo-2000-02.json',machine({validation:{complete:true,valid:false,periodWarning:'period must be rechecked'}}),context);assert.equal(r.totalsMatch,true);assert.equal(r.valid,false);assert.ok(codes(r).includes('machine_source_validation_invalid'));assert.ok(codes(r).includes('machine_period_recheck_required'));
 assert.doesNotThrow(()=>inspectMachine('machine-bo-2000-99.json',null,context));assert.doesNotThrow(()=>inspectRanking(filename,null,ref([]),context));
});
test('filesystem audit keeps four competitor missing dates, source states and machine period warnings without changing input',async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'quality-audit-')),created=[];const write=async(name,d)=>{const p=path.join(dir,name);created.push(p);await fs.writeFile(p,typeof d==='string'?d:JSON.stringify(d));};
 try{
  await write(filename,rank());await write('backend-history-qz.json',{daily:qualityDates('2000-01-01','2000-02-03').map(d=>[d,1,1,1,10,null,null,null,0,0])});
  const header=['日期','DAU','DPU','總筆數','總金額'];await write('competitor-observations.json',{competitors:['o8','aos','fcc','cgb'].map(key=>({key,consumeDaily:{header,rows:[['2000-01-01',1,1,1,10],['2000-02-03',1,1,1,10]]}}))});
  await write('machine-bo-2000-02.json',machine({validation:{complete:true,valid:false,periodWarning:'must recheck'}}));await write('machine-bo-2000-01.json',machine({from:'2000-01-01',through:'2000-01-31',queryThrough:'2000-01-31',partial:false}));await write('deposit-ranking-rd-2000-01.json','broken');
  const before=await fs.readFile(path.join(dir,filename),'utf8'),d=await buildQualityAudit(dir,{today:context.today,launchDates:{}});
  assert.equal(d.coverage.payerRanks.expectedFiles,12);assert.equal(d.coverage.payerRanks.presentCanonicalFiles,2);assert.equal(d.coverage.payerRanks.readableCanonicalFiles,1);assert.equal(d.sourceReadErrors.length,1);
  for(const key of ['o8','aos','fcc','cgb']){const r=d.coverage.daily.find(r=>r.platform===key);assert.equal(r.observedDateCount,2);assert.ok(r.missingCompletedDates.includes('2000-01-02'));assert.equal(r.today.available,true);assert.equal(r.today.partial,true);}
  assert.ok(d.mismatches.some(i=>i.code==='machine_source_validation_invalid'));assert.ok(d.warnings.some(i=>i.code==='identical_machine_details_across_periods'));assert.ok(d.coverage.machines.invalidFiles.includes('machine-bo-2000-01.json'));assert.doesNotMatch(JSON.stringify(d),/never-print-this-aid|never-print-this-nickname/);assert.equal(await fs.readFile(path.join(dir,filename),'utf8'),before);
 }finally{for(const file of created)await fs.unlink(file).catch(e=>{if(e.code!=='ENOENT')throw e;});await fs.rmdir(dir);}
});
