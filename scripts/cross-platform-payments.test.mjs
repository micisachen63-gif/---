import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs/promises';import os from 'node:os';import path from 'node:path';
import {summarizePayers,bridge,buildPayments} from './payment-structure.mjs';
import {makeCohorts,buildCohorts} from './cohort-data.mjs';
const snapshot=(month,cash)=>({complete:true,header:['名次','AID','LineID','暱稱','VIP','最後儲值時間','儲值金額'],rows:cash===null?[]:[['1','same-aid','never-output','同名玩家','','',cash]],period:[month+'-01',month+'-'+new Date(Number(month.slice(0,4)),Number(month.slice(5)),0).getDate()],capturedAt:'2026-10-20T01:00:00Z'});
test('bridge僅同站相鄰月份，保留預設win API',()=>{
 const win=summarizePayers(snapshot('2026-01',100),'2026-01'),qz=summarizePayers(snapshot('2026-02',900),'2026-02','qz');
 assert.equal(win.platform,'win');assert.equal(qz.platform,'qz');assert.throws(()=>bridge(win,qz),/同站/);
 assert.throws(()=>bridge(win,summarizePayers(snapshot('2026-03',10),'2026-03')),/月份連續/);
 assert.equal(bridge(win,summarizePayers(snapshot('2026-02',50),'2026-02')).platform,'win');
});
test('cohort同站分流且缺月不硬比；其他站不沿用Win幣商',()=>{
 assert.deepEqual(makeCohorts([snapshot('2026-01',100),snapshot('2026-03',20)],[],false,'qz'),[]);
 const other=makeCohorts([snapshot('2026-09',100),{...snapshot('2026-10',null),period:['2026-10-01','2026-10-19']}],[],true,'qz')[0];
 assert.equal(other.platform,'qz');assert.equal(other.merchantCovered,false);assert.equal(other.rows[0].currentCash,0);assert.equal(other.rows[0].currentCoins,null);assert.equal(other.rows[0].noRepurchase,null);
});
test('builder讀6站已存在排行，缺檔不補0、相同AID不跨站相扣',async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'owned-payments-'));
 try{
  const files=[['win','2026-01',100],['win','2026-02',50],['qz','2026-01',900],['qz','2026-02',null],['qz','2026-04',500],['song','2026-01',10],['rd','2026-01',20],['lucky','2026-01',30],['bo','2026-01',40]];
  for(const [key,month,cash]of files)await fs.writeFile(path.join(dir,'deposit-ranking-'+key+'-'+month+'.json'),JSON.stringify(snapshot(month,cash)));
  const payments=await buildPayments(dir);assert.equal(payments.months.length,9);assert.equal(payments.bridges.length,2);assert.equal(payments.bridges.find(b=>b.platform==='win').delta,-50);assert.equal(payments.bridges.find(b=>b.platform==='qz').delta,-900);assert.equal(payments.months.some(m=>m.platform==='qz'&&m.month==='2026-03'),false);
  const cohorts=await buildCohorts(dir);assert.equal(cohorts.length,2);assert.equal(cohorts.find(c=>c.platform==='win').rows[0].currentCash,50);assert.equal(cohorts.find(c=>c.platform==='qz').rows[0].currentCash,0);assert.ok(cohorts.every(c=>c.merchantCovered===false));assert.equal(JSON.stringify(cohorts).includes('never-output'),false);
 }finally{await fs.rm(dir,{recursive:true,force:true});}
});
