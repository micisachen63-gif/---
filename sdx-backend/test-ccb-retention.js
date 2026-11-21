'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const sheets=require('./sheets');
const {server,eventSnapshotMatches,viewSnapshot}=require('./server');
async function api(url){
 const r=await fetch('http://127.0.0.1:'+server.address().port+url);
 return {status:r.status,body:await r.json()};
}
test('Stale verified CCB rankings remain visible with a warning and never leak across event epochs',async()=>{
 const prior={status:sheets.eventStatus,read:sheets.readPublicSnapshot};
 const old=new Date(Date.now()-3600000).toISOString();
 let event={phase:'CCB',epoch:44,startTW:'',endTW:'',registeredCount:1};
 const snapshot={ok:true,version:1,status:'testing',testMode:true,
  eventPhase:'CCB',eventEpoch:44,eventStartTW:'',eventEndTW:'',
  lastUpdated:old,source:'local-whitelisted-b2b',
  rankings:{SET2:{BET:[{rank:1,nickname:'測試甲',score:1234}],MULT:[]},
            THOR:{BET:[],MULT:[]}},
  rtp:{SET2:96.2,THOR:null},luckboard:null,
  bankruptcy:null,unavailableModes:['MULT']};
 sheets.eventStatus=async()=>event;
 sheets.readPublicSnapshot=async()=>snapshot;
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 try{
  assert.equal(viewSnapshot(snapshot,event).stale,true);
  assert.equal(eventSnapshotMatches(snapshot,event),true);
  const first=await api('/api/rankings');
  assert.equal(first.status,200);
  assert.equal(first.body.ok,true);
  assert.equal(first.body.stale,true);
  assert.equal(first.body.status,'local_sync_stale');
  assert.equal(first.body.rankings.SET2.BET[0].score,1234);
  assert.equal(first.body.rtp.SET2,96.2);
  event={...event,epoch:45};
  const second=await api('/api/rankings');
  assert.equal(second.body.ok,false);
  assert.equal(second.body.status,'awaiting_local_sync');
  assert.deepEqual(second.body.rankings,{});
  event={...event,phase:'READY'};
  const third=await api('/api/rankings');
  assert.equal(third.body.status,'event_paused');
  assert.equal(third.body.ok,false);
 }finally{
  await new Promise(resolve=>server.close(resolve));
  sheets.eventStatus=prior.status;sheets.readPublicSnapshot=prior.read;
 }
});
