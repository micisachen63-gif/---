'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const sheets=require('./sheets');
const {server}=require('./server');
const TOKEN='test-private-token-for-b2b-verifier-2026-long';
function auth(){return {Authorization:'Bearer '+TOKEN};}
function url(){return 'http://127.0.0.1:'+server.address().port;}
async function req(route,method='GET',body,headers={}){
 const r=await fetch(url()+route,{method,headers:{
  ...(body?{'Content-Type':'application/json'}:{}),...headers},
  body:body?JSON.stringify(body):undefined});
 return {status:r.status,data:await r.json()};
}
test('AID must be verified by local B2B worker BEFORE Google Sheets write',async()=>{
 const previous=process.env.B2B_SYNC_TOKEN;
 process.env.B2B_SYNC_TOKEN=TOKEN;
 const oldCheck=sheets.checkAccess,oldRegister=sheets.register,oldEvent=sheets.eventStatus;
 const written=[];
 sheets.checkAccess=async()=>true;
 sheets.eventStatus=async()=>({phase:'CCB',epoch:1,startTW:'',registeredCount:0});
 sheets.register=async x=>{written.push(x);return {status:201,result:{ok:true,status:'pending_review',registeredAt:'2026-11-20 17:00:00'}};};
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 try{
  const first=await req('/api/registration/status');
  assert.equal(first.data.enabled,false);
  // A client cannot bypass the worker by calling the old endpoint.
  const old=await req('/api/registration','POST',
    {aid:'1000000081',name:'測試玩家',consent:true},{Origin:'https://sdx-winmalo-internal-event-2026.onrender.com'});
  assert.equal(old.status,503);
  assert.equal(written.length,0);

  const badWorker=await req('/api/verifier/jobs');
  assert.equal(badWorker.status,401);
  const wake=await req('/api/verifier/jobs','GET',undefined,auth());
  assert.equal(wake.status,200);
  const ready=await req('/api/registration/status');
  assert.equal(ready.data.enabled,true);
  const missingOrigin=await req('/api/registration/start','POST',
    {aid:'1000000081',name:'測試玩家',consent:true});
  assert.equal(missingOrigin.status,403);

  const start=await req('/api/registration/start','POST',
    {aid:'1000000081',name:'測試玩家',consent:true},
    {Origin:'https://sdx-winmalo-internal-event-2026.onrender.com'});
  assert.equal(start.status,202);
  assert.equal(start.data.status,'verifying');
  assert.equal(written.length,0,'Registration must not append before B2B result');
  const unauthResult=await req('/api/verifier/result','POST',{requestId:start.data.requestId,exists:true});
  assert.equal(unauthResult.status,401);
  assert.equal(written.length,0);
  const work=await req('/api/verifier/jobs','GET',undefined,auth());
  assert.equal(work.data.jobs.length,1);
  assert.deepEqual(work.data.jobs[0],{requestId:start.data.requestId,aid:'1000000081'});
  const fakeQuery=await req('/api/registration/result?requestId='+encodeURIComponent(start.data.requestId)+'&key=incorrect');
  assert.equal(fakeQuery.status,404);
  assert.equal(written.length,0);
  const verdict=await req('/api/verifier/result','POST',{requestId:start.data.requestId,exists:true},auth());
  assert.equal(verdict.status,200);
  assert.equal(verdict.data.status,'registered');
  assert.deepEqual(written,[{aid:'1000000081',name:'測試玩家',consent:true}]);
  const result=await req('/api/registration/result?requestId='+encodeURIComponent(start.data.requestId)+'&key='+encodeURIComponent(start.data.requestKey));
  assert.equal(result.status,200);
  assert.equal(result.data.status,'registered');
  assert.equal(result.data.registeredAt,'2026-11-20 17:00:00');
  assert.ok(!JSON.stringify(result.data).includes('1000000081'));
  assert.ok(!JSON.stringify(result.data).includes('測試玩家'));

  const missing=await req('/api/registration/start','POST',
    {aid:'1000000909',name:'不存在',consent:true},
    {Origin:'https://sdx-winmalo-internal-event-2026.onrender.com'});
  assert.equal(missing.status,202);
  const work2=await req('/api/verifier/jobs','GET',undefined,auth());
  assert.equal(work2.data.jobs.length,1);
  const verdict2=await req('/api/verifier/result','POST',{requestId:missing.data.requestId,exists:false},auth());
  assert.equal(verdict2.data.status,'not_found');
  const rejected=await req('/api/registration/result?requestId='+encodeURIComponent(missing.data.requestId)+'&key='+encodeURIComponent(missing.data.requestKey));
  assert.equal(rejected.data.status,'aid_not_found');
  assert.equal(written.length,1,'Nonexistent AID never reaches Sheets');

  const broken=await req('/api/registration/start','POST',
    {aid:'1000000183',name:'服務異常',consent:true},
    {Origin:'https://sdx-winmalo-internal-event-2026.onrender.com'});
  assert.equal(broken.status,202);
  await req('/api/verifier/jobs','GET',undefined,auth());
  await req('/api/verifier/result','POST',{requestId:broken.data.requestId,error:true},auth());
  const brokenCheck=await req('/api/registration/result?requestId='+encodeURIComponent(broken.data.requestId)+'&key='+encodeURIComponent(broken.data.requestKey));
  assert.equal(brokenCheck.data.status,'b2b_verification_unavailable');
  assert.equal(written.length,1);

 }finally{
  await new Promise(resolve=>server.close(resolve));
  sheets.checkAccess=oldCheck;sheets.register=oldRegister;sheets.eventStatus=oldEvent;
  if(previous===undefined)delete process.env.B2B_SYNC_TOKEN;else process.env.B2B_SYNC_TOKEN=previous;
 }
});
