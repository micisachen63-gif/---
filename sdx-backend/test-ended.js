'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const sheets=require('./sheets');
const {server,eventWindowMillis,completedSnapshotMatches}=require('./server');
const TOKEN='test-private-b2b-token-for-ended-archive-2026-long';
function tw(delta){
 const d=new Date(Date.now()+delta+8*3600000).toISOString().slice(0,19).replace('T',' ');
 return d.replaceAll('-','/');
}
async function api(path,method='GET',body,authenticated=false){
 const res=await fetch('http://127.0.0.1:'+server.address().port+path,{
  method,headers:{...(body?{'Content-Type':'application/json'}:{}),
    ...(authenticated?{'Authorization':'Bearer '+TOKEN}:{})},
  body:body?JSON.stringify(body):undefined
 });
 return {status:res.status,result:await res.json()};
}
test('Official snapshot archives before publish; ended state freezes identical results and disallows any more writes',async()=>{
 const saved={eventStatus:sheets.eventStatus,persist:sheets.persistPublicSnapshot,
  read:sheets.readPublicSnapshot,check:sheets.checkAccess};
 const original=process.env.B2B_SYNC_TOKEN;
 process.env.B2B_SYNC_TOKEN=TOKEN;
 const startTW=tw(-3600000),endTW=tw(3600000);
 let event={phase:'OFFICIAL',epoch:8,startTW,endTW,registeredCount:1},snapshot=null,writes=0;
 sheets.eventStatus=async()=>event;
 sheets.checkAccess=async()=>true;
 sheets.persistPublicSnapshot=async row=>{snapshot=structuredClone(row);writes++;return {ok:true}};
 sheets.readPublicSnapshot=async()=>snapshot;
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 try{
  const input={version:1,source:'local-whitelisted-b2b',lastUpdated:new Date().toISOString(),
   eventEpoch:8,eventPhase:'OFFICIAL',eventStartTW:startTW,eventEndTW:endTW,
   rankings:{SET2:{BET:[{rank:1,nickname:'測試甲',score:80000}],MULT:[]},THOR:{BET:[],MULT:[]}},
   rtp:{SET2:88.5,THOR:null},
   luckboard:{ALL:[{rank:1,nickname:'測試甲',spins:100,bet:80000,rtp:88.5}],
    SET2:[{rank:1,nickname:'測試甲',spins:100,bet:80000,rtp:88.5}],
    THOR:[{rank:null,nickname:'尚無遊戲紀錄',spins:0,bet:0,rtp:null}]}};
  const accepted=await api('/api/ingest','POST',input,true);
  assert.equal(accepted.status,200);
  assert.equal(accepted.result.ok,true);
  assert.equal(writes,1);
  assert.ok(snapshot);
  assert.equal(completedSnapshotMatches(snapshot,{...event,phase:'ENDED'}),true);
  event={...event,phase:'ENDED'};
  snapshot.lastUpdated=new Date(Date.now()-86400000).toISOString();
  const result=await api('/api/rankings');
  assert.equal(result.status,200);
  assert.equal(result.result.ok,true);
  assert.equal(result.result.status,'event_ended');
  assert.equal(result.result.eventPhase,'ENDED');
  assert.equal(result.result.finalized,true);
  assert.equal(result.result.rtp.SET2,88.5);
  assert.equal(result.result.rankings.SET2.BET[0].nickname,'測試甲');
  const rejected=await api('/api/ingest','POST',input,true);
  assert.equal(rejected.status,409);
  assert.equal(writes,1);
  const registration=await api('/api/registration/status');
  assert.equal(registration.result.phase,'ENDED');
  assert.equal(registration.result.enabled,false);
  const again=await api('/api/rankings');
  assert.equal(again.result.lastUpdated,result.result.lastUpdated);
  assert.equal(writes,1);
  assert.ok(Number.isFinite(eventWindowMillis(startTW)));
  assert.ok(Number.isNaN(eventWindowMillis('2026/02/31 00:00:00')));
 }finally{
  await new Promise(resolve=>server.close(resolve));
  sheets.eventStatus=saved.eventStatus;
  sheets.persistPublicSnapshot=saved.persist;
  sheets.readPublicSnapshot=saved.read;
  sheets.checkAccess=saved.check;
  if(original===undefined)delete process.env.B2B_SYNC_TOKEN;
  else process.env.B2B_SYNC_TOKEN=original;
 }
});