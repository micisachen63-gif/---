'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const vm=require('node:vm'),fs=require('node:fs'),path=require('node:path');
const source=fs.readFileSync(path.join(__dirname,'..','sdx-sheets-webapp','Code.gs'),'utf8');
function mock(){
 let current=[
 ['登記時間','AID','真實姓名（僅管理員）','活動代碼','登記狀態','核對狀態','派獎資格','派獎狀態','派獎備註','最後更新'],
 ['old','1000000081','甲','DUAL2026','已登記','AID已驗證','','','',''],
 ['other','88888888','他活動','OTHER','已登記','','','','',''],
 ['old','1000000183','乙','DUAL2026','已登記','AID已驗證','','','','']
 ];
 const kv={};let calls=0;
 const sh={
  getLastRow:()=>current.length,
  getRange:(r,c,h=1,w=1)=>({
    getDisplayValue:()=>String(current[r-1][c-1]),
    getDisplayValues:()=>current.slice(r-1,r-1+h).map(x=>x.slice(c-1,c-1+w)),
    setNumberFormat:()=>{},
    setValues:rows=>{rows.forEach((row,i)=>current[r-1+i]=row)}
  }),
  deleteRow:r=>{calls++;current.splice(r-1,1)},
  deleteRows:(r,n)=>{calls++;current.splice(r-1,n)}
 };
 const props={
  getProperty:k=>kv[k]||null,
  setProperty:(k,v)=>{kv[k]=v}
 };
 const runtime={
  PropertiesService:{getScriptProperties:()=>props},
  SpreadsheetApp:{openById:()=>({getSheetByName:()=>sh}),flush:()=>{}},
  LockService:{getScriptLock:()=>({tryLock:()=>true,releaseLock:()=>{}})},
  Utilities:{formatDate:()=> '2026/12/01 10:00:00'},
  ContentService:{createTextOutput:s=>({setMimeType:()=>s}),MimeType:{JSON:1}},
  Date,JSON,String,Number,Error
 };
 vm.createContext(runtime);
 vm.runInContext(source,runtime);
 return {ctx:runtime,sheet:sh,rows:()=>current,deleted:()=>calls};
}
test('CCB clear wipes only this event registrations, preserves unrelated rows and prevents old CCB sync',()=>{
 const t=mock(),ctx=t.ctx,sh=t.sheet;
 assert.equal(ctx.eventState_().phase,'CCB');
 assert.equal(ctx.eventState_().epoch,1);
 assert.equal(ctx.aids_(sh).length,2);
 assert.equal(ctx.clearCcb_(sh,{confirm:'wrong'}).ok,false);
 assert.equal(t.deleted(),0);
 const result=ctx.clearCcb_(sh,{confirm:'清空CCB資料'});
 assert.equal(result.ok,true);
 assert.equal(result.cleared,2);
 assert.equal(result.event.phase,'READY');
 assert.equal(result.event.epoch,2);
 assert.equal(ctx.aids_(sh).length,0);
 assert.equal(t.rows().length,2);
 assert.equal(t.rows()[1][3],'OTHER');
 const after=ctx.register_(sh,{aid:'1000000099',name:'試玩者',consent:true});
 assert.equal(after.error,'event_paused');
 assert.equal(t.rows().length,2);
 const repeated=ctx.clearCcb_(sh,{confirm:'清空CCB資料'});
 assert.equal(repeated.cleared,0);
 assert.equal(repeated.event.epoch,2);
});
test('official start only after clearing, locks out subsequent delete and records new Taiwan start',()=>{
 const t=mock(),ctx=t.ctx,sh=t.sheet;
 const tooEarly=ctx.startOfficial_(sh,{confirm:'啟動正式活動'});
 assert.equal(tooEarly.ok,false);
 assert.equal(tooEarly.error,'must_clear_ccb_first');
 ctx.clearCcb_(sh,{confirm:'清空CCB資料'});
 const started=ctx.startOfficial_(sh,{confirm:'啟動正式活動'});
 assert.equal(started.ok,true);
 assert.equal(started.event.phase,'OFFICIAL');
 assert.equal(started.event.startTW,'2026/12/01 10:00:00');
 assert.equal(started.event.epoch,3);
 const blocked=ctx.clearCcb_(sh,{confirm:'清空CCB資料'});
 assert.equal(blocked.error,'official_data_protected');
 assert.equal(t.rows().length,2);
});
