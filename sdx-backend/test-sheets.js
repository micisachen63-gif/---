'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const sheets=require('./sheets');
test('Verified AID and submitted real name are sent together to Google Script only after authorization',async()=>{
 const prevUrl=process.env.GOOGLE_SCRIPT_WEBAPP_URL;
 const prevSecret=process.env.GOOGLE_SCRIPT_SECRET;
 const prevFetch=global.fetch;
 const calls=[];
 process.env.GOOGLE_SCRIPT_WEBAPP_URL='https://script.google.com/macros/s/AKfycb-test-registration-app-2026/exec';
 process.env.GOOGLE_SCRIPT_SECRET='unit-test-secret-very-long-and-private-2026';
 global.fetch=async(url,options)=>{
   assert.equal(String(url),process.env.GOOGLE_SCRIPT_WEBAPP_URL);
   assert.equal(options.method,'POST');
   const body=JSON.parse(options.body);
   calls.push(body);
   assert.equal(body.secret,process.env.GOOGLE_SCRIPT_SECRET);
   if(body.action==='status')return {ok:true,json:async()=>({ok:true,enabled:true,spreadsheetId:sheets.SHEET_ID})};
   if(body.action==='register')return {ok:true,json:async()=>({ok:true,status:'pending_review',registeredAt:'2026-11-20 17:30:00'})};
   if(body.action==='aids')return {ok:true,json:async()=>({ok:true,eventCode:'DUAL2026',aids:['1000000081','1000000183']})};
   throw new Error('unexpected_script_action');
 };
 try{
   const valid=sheets.validateRegistration({aid:'1000000081',name:'測試真實姓名',consent:true});
   assert.deepEqual(valid,{aid:'1000000081',name:'測試真實姓名'});
   const res=await sheets.register({aid:'1000000081',name:'測試真實姓名',consent:true});
   assert.equal(res.status,201);
   assert.equal(res.result.registeredAt,'2026-11-20 17:30:00');
   assert.equal(calls[1].action,'register');
   assert.equal(calls[1].aid,'1000000081');
   assert.equal(calls[1].name,'測試真實姓名');
   assert.equal(calls[1].consent,true);
   const ids=await sheets.listAids();
   assert.deepEqual(ids,['1000000081','1000000183']);
   assert.equal(sheets.validateRegistration({aid:'1000000081',name:'=HYPERLINK("bad")',consent:true}),null);
   assert.equal(sheets.validateRegistration({aid:'bad',name:'測試真實姓名',consent:true}),null);
 }finally{
   global.fetch=prevFetch;
   if(prevUrl===undefined)delete process.env.GOOGLE_SCRIPT_WEBAPP_URL;
   else process.env.GOOGLE_SCRIPT_WEBAPP_URL=prevUrl;
   if(prevSecret===undefined)delete process.env.GOOGLE_SCRIPT_SECRET;
   else process.env.GOOGLE_SCRIPT_SECRET=prevSecret;
 }
});
