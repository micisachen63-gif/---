'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const sheets=require('./sheets');
const {server}=require('./server');

const ORIGIN='https://sdx-winmalo-internal-event-2026.onrender.com';
const REQUEST='32f30a39-d684-4b37-8c09-38eae535d911';
async function request(route,method='GET',body,origin){
  const r=await fetch('http://127.0.0.1:'+server.address().port+route,{
    method,
    headers:{...(body?{'Content-Type':'application/json'}:{}),
      ...(origin?{Origin:origin}:{})},
    body:body?JSON.stringify(body):undefined
  });
  return {status:r.status,body:await r.json()};
}
test('top-up API rejects bad fields and off-origin calls, never publishes raw AIDs',async()=>{
  const old={eventStatus:sheets.eventStatus,publicTopupHistory:sheets.publicTopupHistory,
    submitTopup:sheets.submitTopup};
  let writes=0,active='CCB';
  sheets.eventStatus=async()=>({phase:active,epoch:1});
  sheets.publicTopupHistory=async()=>({ok:true,records:[
    {aidMasked:'****0081',amount:200,coins:10000,completedAt:'2026-11-24 12:00:00'}]});
  sheets.submitTopup=async input=>{
    writes++;
    assert.equal(input.aid,'1000000081');
    return {status:201,result:{ok:true,status:'pending_review',
      requestId:input.requestId,amount:input.amount,coins:input.amount*50}};
  };
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  try{
    const status=await request('/api/topup/status');
    assert.equal(status.status,200);assert.equal(status.body.enabled,true);
    assert.equal(status.body.rate,50);
    assert.deepEqual(status.body.amounts,[100,200,300,400,500]);

    const unauthorized=await request('/api/topup/request','POST',
      {aid:'1000000081',amount:200,consent:true,requestId:REQUEST});
    assert.equal(unauthorized.status,403);assert.equal(writes,0);

    const invalid=await request('/api/topup/request','POST',
      {aid:'1000000081',amount:501,consent:true,requestId:REQUEST},ORIGIN);
    assert.equal(invalid.status,400);assert.equal(writes,0);

    const accepted=await request('/api/topup/request','POST',
      {aid:'1000000081',amount:200,consent:true,requestId:REQUEST},ORIGIN);
    assert.equal(accepted.status,201);
    assert.equal(accepted.body.status,'pending_review');
    assert.equal(writes,1);
    assert.ok(!JSON.stringify(accepted.body).includes('1000000081'));

    const history=await request('/api/topup/history');
    assert.equal(history.status,200);
    assert.equal(history.body.records[0].aidMasked,'****0081');
    assert.ok(!JSON.stringify(history.body).includes('1000000081'));

    active='READY';
    const paused=await request('/api/topup/status');
    assert.equal(paused.body.enabled,false);
  }finally{
    await new Promise(resolve=>server.close(resolve));
    Object.assign(sheets,old);
  }
});
test('Sheets adapter validates idempotent request identifiers and denominations',()=>{
  assert.ok(sheets.validateTopup({aid:'1000000081',amount:500,
    consent:true,requestId:REQUEST}));
  assert.equal(sheets.validateTopup({aid:'1000000081',amount:501,
    consent:true,requestId:REQUEST}),null);
  assert.equal(sheets.validateTopup({aid:'1000000081',amount:1,
    consent:true,requestId:REQUEST}),null);
  assert.equal(sheets.validateTopup({aid:'1000000081',amount:100,
    consent:true,requestId:REQUEST,admin:true}),null);
});

test('legacy Apps Script rate is rejected before any top-up write',async()=>{
  const prevUrl=process.env.GOOGLE_SCRIPT_WEBAPP_URL;
  const prevSecret=process.env.GOOGLE_SCRIPT_SECRET;
  const prevFetch=global.fetch;
  process.env.GOOGLE_SCRIPT_WEBAPP_URL='https://script.google.com/macros/s/AKfycb-test-topup-rate/exec';
  process.env.GOOGLE_SCRIPT_SECRET='test-topup-rate-secret-long-enough-2026';
  const calls=[];
  let rate=10;
  global.fetch=async(url,options)=>{
    const body=JSON.parse(options.body);
    calls.push(body.action);
    if(body.action==='topupConfig')return {ok:true,json:async()=>(
      rate===10?{ok:false,error:'invalid_action'}:
      {ok:true,rate:50,limitNTD:500,minAmount:100,maxAmount:500,step:100})};
    if(body.action==='topupSubmit')return {ok:true,json:async()=>({
      ok:true,status:'pending_review',requestId:REQUEST,amount:100,coins:5000})};
    if(body.action==='topupPublic')return {ok:true,json:async()=>({
      ok:true,records:[{aidMasked:'****0081',amount:100,coins:5000,completedAt:'2026-11-24 16:00:00'}]})};
    throw new Error('unexpected mocked action');
  };
  const payload={aid:'1000000081',amount:100,consent:true,requestId:REQUEST};
  try{
    await assert.rejects(sheets.submitTopup(payload),/topup_rate_not_deployed/);
    assert.deepEqual(calls,['topupConfig'],'no charge application under stale rate');
    rate=50;
    const submitted=await sheets.submitTopup(payload);
    assert.equal(submitted.status,201);
    assert.equal(submitted.result.coins,5000);
    const history=await sheets.publicTopupHistory();
    assert.equal(history.records[0].coins,5000);
    assert.ok(!JSON.stringify(history).includes('1000000081'));
  }finally{
    global.fetch=prevFetch;
    if(prevUrl===undefined)delete process.env.GOOGLE_SCRIPT_WEBAPP_URL;
    else process.env.GOOGLE_SCRIPT_WEBAPP_URL=prevUrl;
    if(prevSecret===undefined)delete process.env.GOOGLE_SCRIPT_SECRET;
    else process.env.GOOGLE_SCRIPT_SECRET=prevSecret;
  }
});
