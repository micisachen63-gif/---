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
    {aidMasked:'****0081',amount:200,coins:2000,completedAt:'2026-11-24 12:00:00'}]});
  sheets.submitTopup=async input=>{
    writes++;
    assert.equal(input.aid,'1000000081');
    return {status:201,result:{ok:true,status:'pending_review',
      requestId:input.requestId,amount:input.amount,coins:input.amount*10}};
  };
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  try{
    const status=await request('/api/topup/status');
    assert.equal(status.status,200);assert.equal(status.body.enabled,true);
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
