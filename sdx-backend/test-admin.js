'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const sheets=require('./sheets');
const {server}=require('./server');
const SECRET='unit-only-admin-reset-token-with-strong-length-2026';
async function call(url,method='GET',body,headers={}){
 const resp=await fetch('http://127.0.0.1:'+server.address().port+url,{
  method,headers:{...(body?{'Content-Type':'application/json'}:{}),...headers},
  body:body?JSON.stringify(body):undefined});
 return {http:resp.status,body:await resp.json()};
}
test('CCB reset locks registrations and old leaderboard, then official start is distinct explicit action',async()=>{
 const originals={eventStatus:sheets.eventStatus,clearCcb:sheets.clearCcb,
  startOfficial:sheets.startOfficial,checkAccess:sheets.checkAccess};
 const prior=process.env.ADMIN_RESET_TOKEN;
 process.env.ADMIN_RESET_TOKEN=SECRET;
 let current={phase:'CCB',schemaVersion:3,epoch:1,startTW:'',endTW:'',registeredCount:3},deleted=0,started=0;
 sheets.eventStatus=async()=>current;
 sheets.checkAccess=async()=>true;
 sheets.clearCcb=async()=>{
  if(!['CCB','READY'].includes(current.phase))throw Error('official_data_protected');
  deleted++;
  current={phase:'READY',schemaVersion:4,resetComplete:true,epoch:current.epoch+1,startTW:'',endTW:'',registeredCount:0};
  return {event:current,cleared:3,clearedTabs:{'玩家登記與派獎':3}};
 };
 sheets.startOfficial=async(startTW,endTW)=>{
  if(current.phase!=='READY'||current.registeredCount!==0)throw Error('not_ready');
  started++;
  current={phase:'SCHEDULED',epoch:current.epoch+1,startTW,endTW,registeredCount:0};
  return {event:current};
 };
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 try{
  const unauthorized=await call('/api/admin/event/status');
  assert.equal(unauthorized.http,401);
  const status=await call('/api/admin/event/status','GET',null,{Authorization:'Bearer '+SECRET});
  assert.equal(status.body.event.phase,'CCB');
  const wrong=await call('/api/admin/event/clear-ccb','POST',{confirm:'DELETE'},
    {Authorization:'Bearer '+SECRET});
  assert.equal(wrong.http,400);assert.equal(deleted,0);
  const badOrigin=await call('/api/admin/event/clear-ccb','POST',{confirm:'清空CCB資料'},
    {Authorization:'Bearer '+SECRET,Origin:'https://attacker.invalid'});
  assert.equal(badOrigin.http,403);assert.equal(deleted,0);
  const oldVersion=await call('/api/admin/event/clear-ccb','POST',{confirm:'清空CCB資料'},
    {Authorization:'Bearer '+SECRET,Origin:'https://sdx-winmalo-internal-event-2026.onrender.com'});
  assert.equal(oldVersion.http,409);
  assert.equal(oldVersion.body.error,'ccb_full_reset_requires_script_v4');
  assert.equal(deleted,0);
  current={...current,schemaVersion:4};
  const reset=await call('/api/admin/event/clear-ccb','POST',{confirm:'清空CCB資料'},
    {Authorization:'Bearer '+SECRET,Origin:'https://sdx-winmalo-internal-event-2026.onrender.com'});
  assert.equal(reset.http,200);
  assert.equal(reset.body.cleared,3);assert.equal(reset.body.event.phase,'READY');
  assert.equal(deleted,1);
  const paused=await call('/api/rankings');
  assert.equal(paused.body.status,'event_paused');
  assert.equal(paused.body.ok,false);
  const disabled=await call('/api/registration/status');
  assert.equal(disabled.body.enabled,false);
  assert.equal(disabled.body.phase,'READY');
  const startWrong=await call('/api/admin/event/start-official','POST',{confirm:'No'},
    {Authorization:'Bearer '+SECRET});
  assert.equal(startWrong.http,400);assert.equal(started,0);
  const start=await call('/api/admin/event/start-official','POST',{confirm:'啟動正式活動',
    startTW:'2026/12/01 10:00:00',endTW:'2026/12/01 11:00:00'},
    {Authorization:'Bearer '+SECRET,Origin:'https://sdx-winmalo-internal-event-2026.onrender.com'});
  assert.equal(start.http,200);assert.equal(start.body.event.phase,'SCHEDULED');
  assert.equal(start.body.event.startTW,'2026/12/01 10:00:00');assert.equal(started,1);
  const after=await call('/api/rankings');
  assert.equal(after.body.status,'event_scheduled');
  const noDeleteOfficial=await call('/api/admin/event/clear-ccb','POST',{confirm:'清空CCB資料'},
    {Authorization:'Bearer '+SECRET});
  assert.equal(noDeleteOfficial.http,503);
  assert.equal(deleted,1);
 }finally{
  await new Promise(resolve=>server.close(resolve));
  for(const [key,fn] of Object.entries(originals))sheets[key]=fn;
  if(prior===undefined)delete process.env.ADMIN_RESET_TOKEN;
  else process.env.ADMIN_RESET_TOKEN=prior;
 }
});
