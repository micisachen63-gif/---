import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {rankMap,buildCohorts} from './cohort-data.mjs';

const legacyHeader=['名次','AID','LineID','暱稱','VIP','最後儲值時間','儲值金額','總金額','剩餘金幣','首次登入','最後操作時間','遊戲天數','總轉數'];
const minimal=(cash='123.50',extra={})=>({complete:true,header:['名次','AID','暱稱','儲值金額'],rows:[['1','same-aid','示例玩家',cash]],...extra});
test('Win old thirteen-column source uses named fields and keeps the optional last action',()=>{
 const s={complete:true,header:legacyHeader,rows:[['1','001','private-line-id','Legacy name','2','wrong-date','1,234.50','999999','77777','first-login','2000-10-19 12:34:00','10','42']],validation:{rankingDeposit:1234.5,dailyDeposit:1234.5,matching:true}},m=rankMap(s);
 assert.deepEqual(m.get('001'),{aid:'001',name:'Legacy name',cash:1234.5,lastAction:'2000-10-19 12:34:00'});assert.equal(JSON.stringify([...m.values()]).includes('private-line-id'),false);
});
test('minimal four-column and first-row headers need no positional fallback and preserve missing lastAction as null',()=>{
 let m=rankMap(minimal());assert.deepEqual(m.get('same-aid'),{aid:'same-aid',name:'示例玩家',cash:123.5,lastAction:null});
 m=rankMap({complete:true,rows:[['儲值金額','暱稱','AID','名次'],['50','Reordered','00002','1']]});assert.deepEqual(m.get('00002'),{aid:'00002',name:'Reordered',cash:50,lastAction:null});
});
test('missing or ambiguous required headers, partial sources and empty IDs reject',()=>{
 for(const header of [['名次','AID','暱稱'],['名次','AID','儲值金額'],['名次','暱稱','儲值金額'],['名次','AID','AID','暱稱','儲值金額']])assert.throws(()=>rankMap(minimal('5',{header})),/必要欄|重複/);
 assert.throws(()=>rankMap(minimal('5',{complete:false})),/完整/);assert.throws(()=>rankMap(minimal('5',{rows:[['1','','Name','5']]})),/AID 無效/);
 assert.throws(()=>rankMap(minimal('5',{rows:[['1','same-aid','A','5'],['2','same-aid','B','6']]})),/AID 重複/);
});
test('invalid cash is rejected while true zeros and correctly grouped monetary strings remain valid',()=>{
 for(const cash of ['',null,undefined,'NaN',Infinity,-1,'1,23','1e3','abc'])assert.throws(()=>rankMap({...minimal(),rows:[['1','same-aid','示例玩家',cash]]}),/無效金額/);
 assert.equal(rankMap(minimal('0')).get('same-aid').cash,0);assert.equal(rankMap(minimal('1,234.56')).get('same-aid').cash,1234.56);
});
test('provided validation totals must reconcile with actual parsed ranks',()=>{
 assert.equal(rankMap(minimal('20',{validation:{rankingDeposit:20,dailyDeposit:20,matching:true}})).size,1);
 for(const validation of [{matching:false},{rankingDeposit:21},{dailyDeposit:19},{dailyDeposit:null}])assert.throws(()=>rankMap(minimal('20',{validation})),/總額不符|無效金額/);
});
test('six-site fixture keeps the same AID isolated across old and new schemas',async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'cohort-contract-')),created=[];
 try{
  for(const [i,platform]of ['win','qz','song','rd','lucky','bo'].entries())for(const [month,multiplier]of [['2000-09',10],['2000-10',1]]){
   const cash=(i+1)*multiplier,s=platform==='win'?{complete:true,header:legacyHeader,rows:[['1','same-aid','private','Win example','','',cash,'','','','','','']]}:minimal(cash);
   s.period={from:month+'-01',to:month+'-'+(month==='2000-09'?'30':'19')};s.platform=platform;s.validation={rankingDeposit:cash,dailyDeposit:cash,matching:true};const file=path.join(dir,`deposit-ranking-${platform}-${month}.json`);created.push(file);await fs.writeFile(file,JSON.stringify(s));
  }
  const result=await buildCohorts(dir);assert.equal(result.length,6);
  for(const [i,key]of ['win','qz','song','rd','lucky','bo'].entries()){const c=result.find(c=>c.platform===key);assert.equal(c.rows.length,1);assert.equal(c.rows[0].aid,'same-aid');assert.equal(c.rows[0].prevCash,(i+1)*10);assert.equal(c.rows[0].currentCash,i+1);assert.equal(c.rows[0].lastActionAsOf,null);}
  assert.equal(JSON.stringify(result).includes('private'),false);
 }finally{for(const file of created)await fs.unlink(file).catch(e=>{if(e.code!=='ENOENT')throw e;});await fs.rmdir(dir);}
});
