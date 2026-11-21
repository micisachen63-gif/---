'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const sheets=require('./sheets');
test('Old Apps Script cannot receive startOfficial mutation with dates',async()=>{
 const oldUrl=process.env.GOOGLE_SCRIPT_WEBAPP_URL,oldSecret=process.env.GOOGLE_SCRIPT_SECRET,oldFetch=global.fetch;
 process.env.GOOGLE_SCRIPT_WEBAPP_URL='https://script.google.com/macros/s/AKfycb-old-script-test-version/exec';
 process.env.GOOGLE_SCRIPT_SECRET='unit-test-very-long-configuration-secret-2026';
 const actions=[];
 global.fetch=async(url,opts)=>{
  const input=JSON.parse(opts.body);actions.push(input.action);
  if(input.action!=='eventStatus')throw Error('illegal_state_mutation');
  return {ok:true,json:async()=>({ok:true,event:{phase:'READY',epoch:2,startTW:'',registeredCount:0}})};
 };
 try{
  await assert.rejects(
   sheets.startOfficial('2026/12/01 10:00:00','2026/12/01 11:00:00'),
   /google_script_timed_version_not_deployed/
  );
  assert.deepEqual(actions,['eventStatus']);
 }finally{
  global.fetch=oldFetch;
  if(oldUrl===undefined)delete process.env.GOOGLE_SCRIPT_WEBAPP_URL;
  else process.env.GOOGLE_SCRIPT_WEBAPP_URL=oldUrl;
  if(oldSecret===undefined)delete process.env.GOOGLE_SCRIPT_SECRET;
  else process.env.GOOGLE_SCRIPT_SECRET=oldSecret;
 }
});