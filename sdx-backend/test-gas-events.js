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
 const kv={};let calls=0,clock=Date.parse('2026-11-22T00:00:00+08:00');
 const formulasFor=(sheet,r,c,h,w)=>Array.from({length:h},(_,i)=>Array.from({length:w},(_,j)=>{
  const value=(sheet.rows[r-1+i]||[])[c-1+j];
  return typeof value==='string'&&value.startsWith('=')?value:'';
 }));
 let archive=null;
 const managed=new Map();
 function createManagedSheet(){
  const tab={rows:[],getLastRow(){return this.rows.length},
   getLastColumn(){return Math.max(0,...this.rows.map(x=>x.length))},
   getMaxRows(){return 1000},insertRowsAfter(){},setFrozenRows(){},
   getRange(r,c,h=1,w=1){
    const sheet=this;
    return {
     getDisplayValue:()=>String((sheet.rows[r-1]||[])[c-1]||''),
     getDisplayValues:()=>Array.from({length:h},(_,i)=>Array.from({length:w},(_,j)=>String((sheet.rows[r-1+i]||[])[c-1+j]??''))),
     getValues:()=>Array.from({length:h},(_,i)=>Array.from({length:w},(_,j)=>(sheet.rows[r-1+i]||[])[c-1+j]??'')),
     getFormulas:()=>formulasFor(sheet,r,c,h,w),
     setNumberFormat:()=>{},
     setValues:rows=>rows.forEach((row,i)=>{
      const index=r-1+i;
      if(!sheet.rows[index])sheet.rows[index]=[];
      row.forEach((value,j)=>sheet.rows[index][c-1+j]=value);
     }),
     clearContent:()=>{for(let i=r-1;i<r-1+h;i++)for(let j=c-1;j<c-1+w;j++)
        if(sheet.rows[i])sheet.rows[i][j]=''}
    };
   }
  };return tab;
 }
 const sh={
  getLastRow:()=>current.length,
  getRange:(r,c,h=1,w=1)=>({
    getDisplayValue:()=>String(current[r-1][c-1]),
    getDisplayValues:()=>current.slice(r-1,r-1+h).map(x=>x.slice(c-1,c-1+w)),
    getValues:()=>current.slice(r-1,r-1+h).map(x=>x.slice(c-1,c-1+w)),
    clearContent:()=>{for(let i=r-1;i<r-1+h;i++)for(let j=c-1;j<c-1+w;j++)current[i][j]=''},
    setNumberFormat:()=>{},
    setValues:rows=>{rows.forEach((row,i)=>current[r-1+i]=row)}
  }),
  deleteRow:r=>{calls++;current.splice(r-1,1)},
  deleteRows:(r,n)=>{calls++;current.splice(r-1,n)},
  getLastColumn:()=>Math.max(...current.map(row=>row.length)),
  setFrozenRows:()=>{}
 };
 const archiveSheet={
  rows:[['活動世代','最後同步時間','JSON片段數','公開榜單JSON（D欄起分段）']],
  getLastRow(){return this.rows.length},
  getLastColumn(){return Math.max(...this.rows.map(row=>row.length))},
  setFrozenRows(){},
  getRange(r,c,h=1,w=1){
   const sheet=this;
   return {
    setValues:rows=>{rows.forEach((row,i)=>{sheet.rows[r-1+i]=[...(sheet.rows[r-1+i]||[])];for(let k=0;k<row.length;k++)sheet.rows[r-1+i][c-1+k]=row[k]})},
    getValues:()=>Array.from({length:h},(_,i)=>Array.from({length:w},(_,j)=>(sheet.rows[r-1+i]||[])[c-1+j]??'')),
    getFormulas:()=>formulasFor(sheet,r,c,h,w),
    getDisplayValues:()=>Array.from({length:h},(_,i)=>Array.from({length:w},(_,j)=>String((sheet.rows[r-1+i]||[])[c-1+j]??''))),
    getDisplayValue:()=>String((sheet.rows[r-1]||[])[c-1]||''),
    clearContent:()=>{for(let i=r-1;i<r-1+h;i++)for(let j=c-1;j<c-1+w;j++)sheet.rows[i][j]=''}
   };
  }
 };
 const props={
  getProperty:k=>kv[k]||null,
  setProperty:(k,v)=>{kv[k]=v}
 };
 const runtime={
  PropertiesService:{getScriptProperties:()=>props},
  SpreadsheetApp:{openById:()=>({
   getSheetByName:name=>name==='玩家登記與派獎'?sh:name==='雙神活動公開快照'?archive:managed.get(name)||null,
   insertSheet:name=>{
    if(name==='雙神活動公開快照'){archive=archiveSheet;return archive}
    const tab=createManagedSheet();managed.set(name,tab);return tab;
   }
  }),flush:()=>{}},
  LockService:{getScriptLock:()=>({tryLock:()=>true,releaseLock:()=>{}})},
  Utilities:{
   parseDate:text=>new Date(text.replaceAll('/','-').replace(' ','T')+'+08:00'),
   formatDate:(date,tz,pattern)=>{
    assert.equal(tz,'Asia/Taipei');
    const v=new Date(date.getTime()+8*3600000).toISOString().slice(0,19).replace('T',' ');
    return pattern==='yyyy/MM/dd HH:mm:ss'?v.replaceAll('-','/'):v;
   }
  },
  ContentService:{createTextOutput:s=>({setMimeType:()=>s}),MimeType:{JSON:1}},
  Date:class VirtualDate extends Date{static now(){return clock}},JSON,String,Number,Error
 };
 vm.createContext(runtime);
 vm.runInContext(source,runtime);
 return {ctx:runtime,sheet:sh,rows:()=>current,deleted:()=>calls,
 archive:()=>archive,managed:()=>managed,setNow:v=>{clock=Date.parse(v)}};
}

test('full CCB clear removes archive, raw tickets, sync log and only DUAL2026 public records, while keeping formulas and all headers',()=>{
 const t=mock(),ctx=t.ctx,sh=t.sheet,m=t.managed();
 const specs=vm.runInContext('SDX_CCB_DATA_TABS',ctx);
 for(const spec of specs){
  if(spec.name==='雙神活動公開快照')continue;
  const tab=t.ctx.SpreadsheetApp.openById('test').insertSheet(spec.name);
  const clean=spec.headers.slice();
  if(spec.name==='玩家公開榜單'){
   tab.rows=[clean,
    ['DUAL2026','SET2','BET','****0081','測試',120,0,1,'2026/11/22','2026/11/22'],
    ['OTHER','other','BET','****1111','別的活動',900,0,1,'other','other']];
  }else if(spec.name==='機台原始紀錄'){
   tab.rows=[clean,['TICKET01','SET2',1804,'1000000081','測試','2026/11/22',20,1,20,'OK','sync'],['TICKET02','THOR',1805,'1000000183','測試',33,24,'=SUM(2,3)',50,'OK','sync']];
  }else{
   tab.rows=[clean,['2026/11/22','B2B','SET2',3,'OK','','cursor'],
     ['2026/11/22','B2B','THOR',5,'OK','','cursor']];
  }
 }
 const archive=t.ctx.SpreadsheetApp.openById('test').insertSheet('雙神活動公開快照');
 archive.rows.push([1,'2026-11-22T03:10:00.000Z',2,'{"ok":true}',',"stale":false}']);
 const result=ctx.clearCcb_(sh,{confirm:'清空CCB資料'});
 assert.equal(result.ok,true);
 assert.equal(result.event.phase,'READY');
 assert.equal(result.event.epoch,2);
 assert.equal(result.clearedTabs['玩家登記與派獎'],2);
 assert.equal(result.clearedTabs['玩家公開榜單'],1);
 assert.equal(result.clearedTabs['機台原始紀錄'],2);
 assert.equal(result.clearedTabs['同步紀錄'],2);
 assert.equal(result.clearedTabs['雙神活動公開快照'],1);
 const leaderboard=m.get('玩家公開榜單');
 assert.equal(leaderboard.rows[0][0],'活動識別');
 assert.ok(leaderboard.rows[1].slice(0,10).every(v=>v===''||v==null));
 assert.equal(leaderboard.rows[2][0],'OTHER');
 assert.equal(leaderboard.rows[2][4],'別的活動');
 const raw=m.get('機台原始紀錄');
 assert.equal(raw.rows[1][0],'');
 assert.equal(raw.rows[2][7],'=SUM(2,3)'); // deployed formula preserved
 assert.equal(raw.rows[2][0],'');
 const sync=m.get('同步紀錄');
 assert.equal(sync.rows[0][0],'同步時間');
 assert.ok(sync.rows[1].every(v=>v===''||v==null));
 assert.equal(archive.rows[0][0],'活動世代');
 assert.ok(archive.rows[1].every(v=>v===''||v==null));
 assert.equal(ctx.archivedSnapshot_().snapshot,null);
 const repeated=ctx.clearCcb_(sh,{confirm:'清空CCB資料'});
 assert.equal(repeated.ok,true);
 assert.equal(repeated.event.epoch,2);
 assert.equal(repeated.clearedTabs['玩家公開榜單'],0);
 assert.equal(repeated.clearedTabs['機台原始紀錄'],0);
 assert.equal(repeated.clearedTabs['同步紀錄'],0);
 assert.equal(repeated.clearedTabs['雙神活動公開快照'],0);
});
test('CCB clear rejects a renamed/mismatched data tab and keeps official protection',()=>{
 const t=mock(),ctx=t.ctx,sh=t.sheet;
 const tab=t.ctx.SpreadsheetApp.openById('test').insertSheet('機台原始紀錄');
 tab.rows=[['錯誤表頭'],['private configuration that must not be erased']];
 assert.throws(()=>ctx.clearCcb_(sh,{confirm:'清空CCB資料'}),/ccb_sheet_headers_changed/);
 assert.equal(tab.rows[1][0],'private configuration that must not be erased');
 // A half-completed CCB clear can be retried from READY without touching unrelated records.
 const state=ctx.eventState_();
 assert.equal(state.phase,'READY');
 tab.rows=[...vm.runInContext('SDX_CCB_DATA_TABS',ctx).find(x=>x.name==='機台原始紀錄').headers];
 assert.equal(ctx.clearCcb_(sh,{confirm:'清空CCB資料'}).ok,true);
 assert.equal(ctx.eventState_().epoch,state.epoch);
 ctx.startOfficial_(sh,{confirm:'啟動正式活動',startTW:'2026/12/01 10:00:00',endTW:'2026/12/03 10:00:00'});
 assert.equal(ctx.clearCcb_(sh,{confirm:'清空CCB資料'}).error,'official_data_protected');
});

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
 const started=ctx.startOfficial_(sh,{confirm:'啟動正式活動',
  startTW:'2026/12/01 10:00:00',endTW:'2026/12/03 18:00:00'});
 assert.equal(started.ok,true);
 assert.equal(started.event.phase,'SCHEDULED');
 assert.equal(started.event.startTW,'2026/12/01 10:00:00');
 assert.equal(started.event.endTW,'2026/12/03 18:00:00');
 assert.equal(started.event.epoch,3);
 const blocked=ctx.clearCcb_(sh,{confirm:'清空CCB資料'});
 assert.equal(blocked.error,'official_data_protected');
 assert.equal(t.rows().length,2);
});

test('future start schedules automatically, final archive remains unchanged after deadline',()=>{
 const t=mock(),ctx=t.ctx,sh=t.sheet;
 ctx.clearCcb_(sh,{confirm:'清空CCB資料'});
 const invalid=ctx.startOfficial_(sh,{confirm:'啟動正式活動',
  startTW:'2026/12/03 18:00:00',endTW:'2026/12/01 10:00:00'});
 assert.equal(invalid.ok,false);
 assert.equal(invalid.error,'invalid_event_dates');
 const started=ctx.startOfficial_(sh,{confirm:'啟動正式活動',
  startTW:'2026/12/01 10:00:00',endTW:'2026/12/01 11:00:00'});
 assert.equal(started.event.phase,'SCHEDULED');
 assert.equal(ctx.register_(sh,{aid:'1000000188',name:'假裝報名',consent:true}).error,'event_paused');
 t.setNow('2026-12-01T10:05:00+08:00');
 assert.equal(ctx.eventState_().phase,'OFFICIAL');
 const snapshot={ok:true,version:1,source:'local-whitelisted-b2b',
  lastUpdated:'2026-12-01T02:04:00.000Z',eventEpoch:3,eventPhase:'OFFICIAL',
  eventStartTW:'2026/12/01 10:00:00',eventEndTW:'2026/12/01 11:00:00',
  rankings:{SET2:{BET:[],MULT:[]},THOR:{BET:[],MULT:[]}},
  rtp:{SET2:88.49,THOR:100},luckboard:{ALL:[],SET2:[],THOR:[]}};
 const ledger={eventEpoch:3,registeredAids:[],lastUpdated:snapshot.lastUpdated,
   machineRows:{SET2:{BET:[],MULT:[],ACH:[]},THOR:{BET:[],MULT:[],ACH:[]}}};
 assert.equal(ctx.persistSnapshot_(sh,{snapshot,awardLedger:ledger}).ok,true);
 assert.equal(ctx.archivedSnapshot_().snapshot.rtp.SET2,88.49);
 const archivedBefore=JSON.stringify(t.archive().rows);
 t.setNow('2026-12-01T11:00:00+08:00');
 assert.equal(ctx.eventState_().phase,'ENDED');
 assert.equal(ctx.register_(sh,{aid:'1000000299',name:'結束後',consent:true}).error,'event_paused');
 const rejected=ctx.persistSnapshot_(sh,{snapshot:{...snapshot,lastUpdated:'2026-12-01T03:01:00.000Z'}});
 assert.equal(rejected.ok,false);
 assert.equal(rejected.error,'event_not_running');
 assert.equal(JSON.stringify(t.archive().rows),archivedBefore);
 assert.equal(ctx.archivedSnapshot_().snapshot.rtp.SET2,88.49);
 assert.equal(ctx.clearCcb_(sh,{confirm:'清空CCB資料'}).error,'official_data_protected');
});

test('CCB snapshots survive a Render restart and are invalidated by CCB clear epoch',()=>{
 const t=mock(),ctx=t.ctx,sh=t.sheet;
 const snap={ok:true,version:1,source:'local-whitelisted-b2b',
  lastUpdated:'2026-11-21T18:20:00.000Z',eventEpoch:1,eventPhase:'CCB',
  eventStartTW:'',eventEndTW:'',
  rankings:{SET2:{BET:[{rank:1,nickname:'測試',score:10}],MULT:[]},
            THOR:{BET:[],MULT:[]}},
  luckboard:{ALL:[],SET2:[],THOR:[]},
  bankruptcy:{status:'unavailable',total:2,checked:0,count:null,percentage:null,rows:[]}};
 const saved=ctx.persistSnapshot_(sh,{snapshot:snap});
 assert.equal(saved.ok,true);
 assert.equal(saved.epoch,1);
 assert.equal(ctx.archivedSnapshot_().snapshot.bankruptcy.count,null);
 assert.equal(ctx.archivedSnapshot_().snapshot.rankings.SET2.BET[0].nickname,'測試');
 const cleared=ctx.clearCcb_(sh,{confirm:'清空CCB資料'});
 assert.equal(cleared.event.phase,'READY');
 assert.equal(cleared.event.epoch,2);
 assert.equal(ctx.archivedSnapshot_().snapshot,null);
 const rejected=ctx.persistSnapshot_(sh,{snapshot:snap});
 assert.equal(rejected.ok,false);
 assert.equal(rejected.error,'event_not_running');
});

test('The same CCB snapshot populates four manager-only payout tabs; manual payout fields survive refresh, clear resets test rows',()=>{
 const t=mock(),ctx=t.ctx,sh=t.sheet;
 const payload={ok:true,version:1,source:'local-whitelisted-b2b',
  lastUpdated:'2026-11-22T03:10:00.000Z',eventEpoch:1,eventPhase:'CCB',
  eventStartTW:'',eventEndTW:'',
  rankings:{
   SET2:{BET:[{rank:1,nickname:'甲',score:700000}],MULT:[{rank:1,nickname:'甲',score:1100}]},
   THOR:{BET:[{rank:1,nickname:'乙',score:300000}],MULT:[{rank:1,nickname:'乙',score:999}]}
  },
  luckboard:{ALL:[{rank:1,nickname:'甲',spins:100,bet:700000,rtp:90},{rank:2,nickname:'乙',spins:80,bet:300000,rtp:95}],
    SET2:[{rank:1,nickname:'甲',spins:100,bet:700000,rtp:90}],
    THOR:[{rank:1,nickname:'乙',spins:80,bet:300000,rtp:95}]}
 };
 const ledger={eventEpoch:1,registeredAids:['1000000081','1000000183'],lastUpdated:payload.lastUpdated,machineRows:{
   SET2:{
    BET:[{aid:'1000000081',rank:1,nickname:'甲',score:700000}],
    MULT:[{aid:'1000000081',rank:1,nickname:'甲',score:1100}],
    ACH:[{aid:'1000000081',nickname:'甲',bet:700000}]},
   THOR:{
    BET:[{aid:'1000000183',rank:1,nickname:'乙',score:300000}],
    MULT:[{aid:'1000000183',rank:1,nickname:'乙',score:999}],
    ACH:[{aid:'1000000183',nickname:'乙',bet:300000}]}
 }};
 const result=ctx.persistSnapshot_(sh,{snapshot:payload,awardLedger:ledger});
 assert.equal(result.ok,true);
 assert.equal(result.ledgerUpdated,true);
 assert.equal(result.ledgerUpdatedAt,payload.lastUpdated);
 assert.deepEqual([...Object.keys(result.ledgerCounts)].sort(),['achievement','bet','mult','participants']);
 assert.equal(result.ledgerCounts.participants,2);
 const byName=name=>t.managed().get(name).rows;
 const bet=byName('後勤_累積投注榜');
 const mult=byName('後勤_單把倍率榜');
 const ach=byName('後勤_個人成就榜');
 const total=byName('後勤_派獎總表');
 assert.equal(bet.length,3);
 assert.equal(mult.length,3);
 assert.equal(ach.length,3);
 assert.equal(total.length,3);
 assert.equal(bet[1][4],'1000000081');
 assert.equal(bet[1][5],'甲');
 assert.equal(bet[1][8],400);
 assert.equal(ach[1][10],3);
 assert.equal(ach[1][11],150);
 assert.equal(ach[2][10],2);
 assert.equal(ach[2][11],100);
 assert.equal(total[1][11],950);
 assert.equal(total[2][11],900);
 assert.equal(total[1][13],'未派獎');
 // CCB is only a test, yet any notes entered by staff must remain untouched.
 total[1][12]=950;
 total[1][13]='後勤待確認';
 total[1][14]=0;
 total[1][15]='';
 total[1][16]='特別核對';
 total[2][12]=0; // zero approved amount must NOT be blanked on refresh
 total[2][14]=0; // zero amount paid must NOT become missing
 const refreshed=ctx.persistSnapshot_(sh,{snapshot:{...payload,lastUpdated:'2026-11-22T03:12:00.000Z'},
    awardLedger:{...ledger,lastUpdated:'2026-11-22T03:12:00.000Z'}});
 assert.equal(refreshed.ok,true);
 const after=byName('後勤_派獎總表');
 assert.equal(after[1][12],950);
 assert.equal(after[1][13],'後勤待確認');
 assert.equal(after[1][14],0);
 assert.equal(after[1][16],'特別核對');
 assert.equal(after[2][12],0);
 assert.equal(after[2][14],0);
 assert.equal(ctx.archivedSnapshot_().snapshot.awardLedger,undefined);
 const cleared=ctx.clearCcb_(sh,{confirm:'清空CCB資料'});
 assert.equal(cleared.ok,true);
 for(const name of ['後勤_累積投注榜','後勤_單把倍率榜','後勤_個人成就榜','後勤_派獎總表']){
  const row=byName(name)[1];
  assert.ok(row.every(cell=>cell===''||cell===undefined),name+' was not cleared');
 }
});
test('An unregistered AID cannot be put on a manager payout sheet and does not change public archive',()=>{
 const t=mock(),ctx=t.ctx,sh=t.sheet;
 const snapshot={ok:true,version:1,source:'local-whitelisted-b2b',
  lastUpdated:'2026-11-22T03:20:00.000Z',eventEpoch:1,eventPhase:'CCB',
  eventStartTW:'',eventEndTW:'',
  rankings:{SET2:{BET:[{rank:1,nickname:'他人',score:500000}],MULT:[]},THOR:{BET:[],MULT:[]}},
  luckboard:{ALL:[{rank:1,nickname:'他人',spins:1,bet:500000,rtp:99}],SET2:[],THOR:[]}};
 const ledger={eventEpoch:1,registeredAids:['1000000999'],lastUpdated:snapshot.lastUpdated,machineRows:{
  SET2:{BET:[{aid:'1000000999',rank:1,nickname:'他人',score:500000}],MULT:[],ACH:[]},
  THOR:{BET:[],MULT:[],ACH:[]}
 }};
 assert.throws(()=>ctx.persistSnapshot_(sh,{snapshot,awardLedger:ledger}),/award_ledger_roster_invalid/);
 assert.equal(t.archive(),null);
 assert.equal(t.managed().size,0);
});
