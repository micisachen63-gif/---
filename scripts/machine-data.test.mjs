import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import {parseMachineNumber,normalizeMachineData,buildMachineData} from './machine-data.mjs';

const header=['廠商名稱','機台名稱','不重複玩家數','投注筆數','總投注額','有效投注額','總出分','遊戲淨利','RTP','淨利表','活動加贈'];
const meta={platform:'win',from:'2026-10-01',through:'2026-10-20',sourceUrl:'https://example.test/game-statements/statistics',capturedAt:'2026-10-20T09:00:00Z'};
const detail=['RSG電子','羅馬競技場','12','1,535','7,696.20','7,696.20','6,693.40','1,002.80','86.97%','13.03%','0.00'];
test('unknown values remain null; signed profit parses separately from nonnegative bets',()=>{
 for(const v of [null,undefined,'','-','—','N/A',true,NaN,Infinity,'1x',-1])assert.equal(parseMachineNumber(v),null);
 assert.equal(parseMachineNumber('1,234.50'),1234.5);assert.equal(parseMachineNumber('0'),0);
 assert.equal(parseMachineNumber('-1,234.50',{signed:true}),-1234.5);
});
test('actual backend header and spanning footer normalize without inventing machine IDs or player totals',()=>{
 const footer=['加總','1,535','7,696.20','7,696.20','6,693.40','1,002.80','86.97%','13.03%','0.00'];
 const source={...meta,header,rows:[detail,footer]},data=normalizeMachineData(source),r=data.rows[0];
 assert.equal(data.rows.length,1);assert.equal(data.totals.length,1);assert.equal(r.machineId,null);assert.equal(r.gameName,null);assert.equal(r.vendor,'RSG電子');
 assert.equal(r.rounds,1535);assert.equal(r.players,12);assert.equal(r.bets,7696.2);assert.equal(r.effectiveBets,7696.2);assert.equal(r.gameProfit,1002.8);
 assert.equal(r.reportedRtp,.8697);assert.equal(r.reportedRtpRaw,'86.97%');assert.equal(r.rtp,6693.4/7696.2);assert.equal(r.platformLoss,6693.4-7696.2);
 assert.equal(data.totals[0].players,null);assert.equal(data.reconciliation.bets.matches,true);assert.equal(data.reconciliation.payouts.matches,true);assert.equal(data.reconciliation.rounds.matches,true);
 assert.deepEqual(r.raw,detail);assert.deepEqual(source.rows[0],detail);assert.deepEqual(data.totals[0].raw,footer);
});
test('same-name source rows stay separate; actual-ID conflicts are quarantined',()=>{
 const a=['T9棋牌','T9','1','21','5296','5238.32','3896.32','1399.68','73.57%','26.43%','0'];
 const b=['T9棋牌','T9','1','3','3000','1000','2000','1000','66.67%','33.33%','0'];
 const names=normalizeMachineData({...meta,header,rows:[a,b]});assert.equal(names.rows.length,2);assert.notEqual(names.rows[0].observationKey,names.rows[1].observationKey);assert.equal(names.rejected.length,0);
 const row={...meta,machineId:'001',machineName:'one',bets:100,payouts:90,rounds:5,players:2};
 const conflict=normalizeMachineData([row,{...row,payouts:120}]);assert.equal(conflict.rows.length,0);assert.equal(conflict.rejected.length,2);
 const identical=normalizeMachineData([row,{...row}]);assert.equal(identical.rows.length,1);
});
test('unlabelled actual report rows retain raw values and are explicitly unattributed',()=>{
 const raw=['','','0','5,369','20,521,150.00','20,521,150.00','26,926,737.50','-6,405,587.50','131.21%','-31.21%','0'];
 const result=normalizeMachineData({...meta,header,rows:[raw]});
 assert.equal(result.rows.length,1);assert.equal(result.rows[0].machineId,null);assert.equal(result.rows[0].machineName,null);assert.equal(result.rows[0].vendor,null);assert.equal(result.rows[0].identityMissing,true);assert.equal(result.rows[0].bets,20521150);assert.equal(result.rows[0].gameProfit,-6405587.5);
 assert.equal(result.rejected.length,0);
});
test('vendor summaries are excluded; missing samples do not become zero',()=>{
 const row={...meta,machineId:'A',machineName:'one',bets:100,payouts:120,rounds:null,players:null};
 const result=normalizeMachineData([row,{...row,machineId:'B',granularity:'vendor'},{...row,machineId:'C',from:'2026-02-30'}]);
 assert.equal(result.rows.length,1);assert.equal(result.rejected.length,2);assert.equal(result.rows[0].rounds,null);assert.equal(result.rows[0].rtp,1.2);
 const zero=normalizeMachineData([{...row,bets:0,payouts:0}]).rows[0];assert.equal(zero.rtp,null);assert.equal(zero.platformLoss,0);
});
test('builder reads standalone captures, retains validation and reports missing months',async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'machine-data-'));
 try{
  await fs.writeFile(path.join(dir,'machine-win-2026-10.json'),JSON.stringify({...meta,header,rows:[detail],validation:{valid:true,complete:true}}));
  await fs.writeFile(path.join(dir,'machine-qz-2026-10.json'),'{invalid');
  await fs.writeFile(path.join(dir,'machine-bo-2026-10.json'),JSON.stringify({...meta,platform:'bo',header,rows:[detail],validation:{valid:false,periodWarning:'查詢期間待重新核對'}}));
  const result=await buildMachineData(dir,{expected:[{platform:'win',month:'2026-09'}]});
  assert.equal(result.rows.length,1);assert.equal(result.snapshots.find(s=>s.platform==='win').sourceValidation.valid,true);assert(result.pending.some(p=>p.platform==='qz'));assert(result.pending.some(p=>p.month==='2026-09'));
  assert.equal(result.snapshots.find(s=>s.platform==='bo').rowCount,0);assert.equal(result.snapshots.find(s=>s.platform==='bo').sourceValidation.periodWarning,'查詢期間待重新核對');assert(result.pending.some(p=>p.platform==='bo'&&p.reason==='查詢期間待重新核對'));
 }finally{assert(path.resolve(dir).startsWith(path.join(path.resolve(os.tmpdir()),'machine-data-')));await fs.rm(dir,{recursive:true,force:true})}
});

async function uiContext(data){
 const source=await fs.readFile(new URL('../app/machine-analysis.js',import.meta.url),'utf8');
 const ctx={D:{machines:data},state:{product:'win',month:'2026-10'},num:(n,d=0)=>n==null?'—':Number(n).toLocaleString('en-US',{minimumFractionDigits:d,maximumFractionDigits:d})};
 vm.createContext(ctx);vm.runInContext(source,ctx);return ctx;
}
test('RTP observation requires both samples, preserves equality and never infers a cause',async()=>{
 const ctx=await uiContext({rows:[]});
 const classify=raw=>vm.runInContext('machineObservation('+JSON.stringify(raw)+')',ctx);
 assert.equal(classify({bets:2000000,payouts:3000000,rounds:null,rtp:1.5}).kind,'sample');
 assert.equal(classify({bets:2000000,payouts:3000000,rounds:999,rtp:1.5}).kind,'sample');
 assert.equal(classify({bets:1000000,payouts:1050000,rounds:1000,rtp:1.05}).kind,'normal');
 assert.equal(classify({bets:1000000,payouts:1050001,rounds:1000,rtp:1.050001}).kind,'high');
 assert.equal(classify({bets:1000000,payouts:849999,rounds:1000,rtp:.849999}).kind,'low');
 assert.equal(classify({bets:null,payouts:1,rounds:1000,rtp:null}).kind,'missing');
});
test('page uses one period snapshot, computes weighted RTP and renders unknown IDs safely',async()=>{
 const rows=[
  {...meta,machineId:null,machineName:'<script>one</script>',vendor:'A',bets:1000000,payouts:1200000,rounds:2000,players:5,sourceRow:1},
  {...meta,machineId:null,machineName:'two',vendor:'A',bets:3000000,payouts:2400000,rounds:2000,players:5,sourceRow:2},
  {...meta,through:'2026-10-19',machineId:'old',machineName:'old snapshot',bets:5000000,payouts:1,rounds:1000,players:4}
 ];
 const ctx=await uiContext({rows});
 const html=vm.runInContext('machineAnalysisPanel("win","2026-10")',ctx);
 assert(html.includes('90.00%'));assert(!html.includes('old snapshot'));assert(html.includes('後台未提供 ID'));assert(html.includes('&lt;script&gt;'));assert(!html.includes('<script>'));assert(!/NaN|undefined/.test(html));
 assert(html.includes('遊戲幣'));assert(html.includes('不重複玩家數不能相加'));assert.equal(vm.runInContext('machineAnalysisRows("win","2026-10").rows.length',ctx),2);
 const pending=vm.runInContext('machineAnalysisPanel("qz","2026-10")',ctx);assert(pending.includes('本月機台明細待收集'));
});
test('all-platform coverage keeps each site separate and links to the source site',async()=>{
 const rows=[{...meta,machineId:'A',machineName:'one',bets:100,payouts:90,rounds:1000,players:5},{...meta,platform:'qz',machineId:'B',machineName:'two',bets:10000,payouts:9600,rounds:1000,players:5}];
 const ctx=await uiContext({rows});ctx.D.platforms=[{key:'win',name:'贏麻了'},{key:'qz',name:'茄子'},{key:'song',name:'爽爆'}];
 const html=vm.runInContext('machineAnalysisPanel("all","2026-10")',ctx);
 assert(html.includes('90.00%'));assert(html.includes('96.00%'));assert(html.includes('data-product-link="win"'));assert(html.includes('data-product-link="qz"'));assert(html.includes('待收集'));assert(!html.includes('10,100'));assert(!html.includes('9,690'));assert(!html.includes('機台投注榜'));
});
test('unverified-period metadata remains visible while its rows stay absent',async()=>{
 const snapshot={platform:'bo',month:'2026-10',from:'2026-10-01',through:'2026-10-20',sourceValidation:{valid:false,periodWarning:'兩個期間出現相同舊表，待核對'}};
 const ctx=await uiContext({rows:[],snapshots:[snapshot]});ctx.D.platforms=[{key:'bo',name:'來博'}];
 const single=vm.runInContext('machineAnalysisPanel("bo","2026-10")',ctx),all=vm.runInContext('machineAnalysisPanel("all","2026-10")',ctx);
 assert(single.includes('兩個期間出現相同舊表，待核對'));assert(single.includes('本月機台來源待核對'));assert(all.includes('兩個期間出現相同舊表，待核對'));assert(all.includes('待核對'));assert(!single.includes('ma-kpis'));
});
