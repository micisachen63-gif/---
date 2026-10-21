import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {detailRefreshPeriods,detailRefreshRemaining,runDetailRefresh} from './detail-refresh.mjs';

const stamp='2026-10-22T00:00:00Z',now=()=>new Date(stamp),start=Date.parse(stamp);
async function workspace(t){const live=await fs.mkdtemp(path.join(os.tmpdir(),'detail-refresh-'));t.after(()=>fs.rm(live,{recursive:true,force:true}));return{collectRegistrationPeriod:async()=>({ok:true,status:'success'}),live,today:'2026-10-22',startedAt:start,clock:()=>start,now};}
const success=async opts=>({platforms:[{platform:opts.platforms[0],state:'succeeded',updatedViews:opts.kinds,outcomes:opts.kinds.map(kind=>({kind,ok:true}))}]});

test('closed calendar windows preserve full-month comparisons and never invent February dates',()=>{
 assert.deepEqual(detailRefreshPeriods('2026-10-22'),{current:{from:'2026-10-01',through:'2026-10-21'},previous:{from:'2026-09-01',through:'2026-09-21'},previousFull:{from:'2026-09-01',through:'2026-09-30'},previousComparable:true});
 assert.equal(detailRefreshPeriods('2026-11-01').previous.through,'2026-09-30');
 assert.equal(detailRefreshPeriods('2026-03-30').previous,null);
 assert.equal(detailRefreshRemaining(start,99*60000,start+60000),22*60000);
});
test('one shared lock covers registration and all domains; complete historical ranks are not collected again',async t=>{
 const opts=await workspace(t),details=[],registrations=[];let locks=0,releases=0;
 const result=await runDetailRefresh({...opts,platforms:['win','goldfun'],lock:async()=>{locks++;return async()=>{releases++;};},collectRegistration:async o=>{registrations.push(o);return{ok:true,status:'success'};},collectDetails:async o=>{details.push(o);return success(o);},hasFullRank:async()=>true});
 assert.equal(result.ok,true);assert.equal(locks,1);assert.equal(releases,1);assert.deepEqual(registrations.map(o=>o.platform),['win']);assert(details.every(o=>o.lockHeld===true));assert(registrations.every(o=>o.lockHeld===true));assert.deepEqual(details.map(o=>o.kinds),[['ranks','members','machines'],['ranks','members','machines'],['ranks','machines'],['ranks','machines']]);assert(details.every(o=>o.maxRunMs<=23*60000-30000));
 assert.equal(result.stages.filter(s=>s.phase==='previous_full_rank'&&s.status==='existing_complete_source').length,2);
});
test('competitor independent registration refreshes both exact closed scopes under the held lock',async t=>{const opts=await workspace(t),calls=[];const result=await runDetailRefresh({...opts,platforms:['aos','fcc','cgb','o8','goldfun','o9'],lockHeld:true,collectRegistrationPeriod:async o=>{calls.push(o);return{ok:true,status:'success'};},collectRegistration:async()=>{throw Error('owned only');},collectDetails:success,hasFullRank:async()=>true});assert.equal(result.ok,true);assert.equal(calls.length,12);for(const platform of result.platforms){assert.deepEqual(calls.filter(o=>o.platform===platform).map(o=>[o.from,o.through]),[['2026-10-01','2026-10-21'],['2026-09-01','2026-09-21']]);}assert(calls.every(o=>o.lockHeld&&o.maxRunMs<=90000));});

test('unknown permissions fail independently and full previous month is attempted only when missing',async t=>{
 const opts=await workspace(t),calls=[];const result=await runDetailRefresh({...opts,lockHeld:true,platforms:['o9'],lock:async()=>{throw Error('nested lock');},collectDetails:async o=>{calls.push(o);if(o.kinds.includes('members'))return{platforms:[{state:'partial',updatedViews:['ranks','machines'],outcomes:[{kind:'members',ok:false,error:'PRIVATE_BODY'}]}]};return success(o);},hasFullRank:async()=>false});
 assert.equal(result.partial,true);assert.equal(calls.length,3);assert.deepEqual(calls[2].kinds,['ranks']);assert.equal(calls[2].through,'2026-09-30');assert.equal(result.errors[0].error,'details_capture_failed');assert(!JSON.stringify(result).includes('PRIVATE'));
});
test('expired budget never opens browser and later exhaustion records explicit per-domain gaps',async t=>{
 const opts=await workspace(t);let opened=0;const expired=await runDetailRefresh({...opts,maxTotalMs:1000,platforms:['win'],collectDetails:async()=>{opened++;},collectRegistration:async()=>{opened++;},lock:async()=>{opened++;}});assert.equal(opened,0);assert.equal(expired.errors[0].error,'run_deadline_exceeded');
 let tick=start;const partial=await runDetailRefresh({...opts,platforms:['o9'],lockHeld:true,clock:()=>tick,collectDetails:async o=>{tick=start+23*60000;return success(o);},hasFullRank:async()=>false});assert.equal(partial.partial,true);const status=JSON.parse(await fs.readFile(path.join(opts.live,'platform-details-archive/o9/status.json'),'utf8'));assert(status.entries.some(s=>s.kind==='ranks'&&s.lastAttemptStatus==='failed'));assert(status.entries.every(s=>s.error==='run_deadline_exceeded'));
});
test('busy work and paused Bo cannot create a collection context',async t=>{
 const opts=await workspace(t),busy=await runDetailRefresh({...opts,platforms:['o8'],lock:async()=>null,collectDetails:async()=>{throw Error('must not open');}});assert.equal(busy.busy,true);await assert.rejects(runDetailRefresh({...opts,platforms:['bo'],availability:{platforms:{bo:{state:'temporarily_unavailable'}}}}),/invalid_platform/);
});
test('Bo recovery adds registration and detail attempts without bypassing runtime authentication',async t=>{const opts=await workspace(t),calls=[];const result=await runDetailRefresh({...opts,platforms:['bo'],lockHeld:true,availability:{platforms:{bo:{state:'recovery_reported'}}},collectRegistration:async o=>{calls.push(o.platform);return{ok:true,status:'success'};},collectDetails:success,hasFullRank:async()=>true});assert.equal(result.ok,true);assert.deepEqual(calls,['bo']);});
