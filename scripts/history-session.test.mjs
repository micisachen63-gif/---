import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {EventEmitter} from 'node:events';
import {createHistoryPlan,mergeHistoryState,historyCoverageFromDashboard,runHistoryBackfill} from './history-backfill.mjs';
import {historyRuntimeBlocked,selectHistorySessionWork,validatedHistoryMemberCoverage,runHistorySessionCycle,runHistorySession,spawnHistorySessionCycle,parseHistorySessionArguments,safeHistorySessionResult} from './history-session.mjs';

const stamp='2026-10-21T03:30:00.000Z',today='2026-10-21',now=()=>new Date(stamp),sha='a'.repeat(64);
const clone=v=>structuredClone(v),base=(version='base')=>({schema:1,generatedAt:stamp,platforms:[],monthly:[],daily:{},version});
function queueFixture(){const q=mergeHistoryState(createHistoryPlan({year:2026,today}));for(const t of q.tasks)t.state='succeeded';return q;}
function fixture(extra={}){
 let queue=queueFixture(),status={},dashboard=base(),reads=0;queue.tasks[0].state='pending';
 const events=[],writes=[];
 const options={year:2026,cycleMs:600000,root:'fixture-root',live:'fixture-live',opsRoot:'fixture-ops',now,clock:()=>1000,
  stopping:async()=>false,readDashboard:async()=>{reads++;return clone(dashboard);},readQueue:async()=>clone(queue),readBlocks:async()=>null,readMemberCoverage:async()=>[],readStatus:async()=>clone(status),writeStatus:async value=>{status=clone(value);writes.push(clone(value));events.push('status');},
  runBackfill:async opts=>{events.push('collect');const task=queue.tasks.find(t=>opts.taskFilter(t,queue));if(task){task.state='succeeded';task.attempts++;queue.lastCycle={attemptedIds:[task.id]};}events.push('release');return{busy:false,lastCycle:queue.lastCycle};},
  overlay:async opts=>{events.push('overlay');assert(events.includes('release'));assert.equal(opts.previous.version,dashboard.version);return{...opts.previous,generatedAt:stamp,update:{partial:true,statusOnly:false,updatedDomains:['historyProgress']}};},
  readToken:async()=>{events.push('token');return 'private-fixture-token';},publish:async(data,token)=>{events.push('publish');assert.equal(token,'private-fixture-token');return{ok:true,sha256:sha};},persist:async data=>{events.push('persist');dashboard=clone(data);},...extra};
 return{options,events,writes,get queue(){return queue;},set queue(v){queue=v;},get status(){return status;},set status(v){status=v;},get dashboard(){return dashboard;},set dashboard(v){dashboard=v;},get reads(){return reads;}};
}
test('pending tasks precede retries globally; retry once respects retryAt and never retries missing/login tasks',()=>{
 const q=queueFixture(),[a,b,c,d,e]=q.tasks;a.state='failed';a.attempts=1;a.lastError='capture_failed';a.retryAt='2026-10-20T01:00:00Z';b.state='pending';b.priority=1;c.state='failed';c.attempts=2;c.lastError='capture_failed';d.state='missing';d.lastError='handler_missing';e.state='failed';e.lastError='captcha_required';
 assert.deepEqual(selectHistorySessionWork(q,{now:Date.parse(stamp)}).ids,[b.id]);b.state='succeeded';assert.deepEqual(selectHistorySessionWork(q,{now:Date.parse(stamp)}).ids,[a.id]);a.retryAt='2026-10-22T00:00:00Z';const waiting=selectHistorySessionWork(q,{now:Date.parse(stamp)});assert.equal(waiting.phase,'waiting');assert.equal(waiting.nextRetryAt,a.retryAt);a.attempts=2;assert.equal(selectHistorySessionWork(q,{now:Date.parse(stamp)}).phase,'blocked');
});
test('runtime login blocks preserve the complete queue, while newer resolved checks permit Win/Song and fresh failures block again',()=>{
 const q=queueFixture();for(const t of q.tasks)if(['win','song'].includes(t.platform))t.state='pending';const win=q.tasks.find(t=>t.platform==='win');win.state='failed';win.lastError='login_required';win.lastAttemptAt='2026-10-21T03:07:09Z';
 const blocks={schema:1,year:2026,platforms:{win:{state:'resolved',active:false,resolvedAt:'2026-10-21T03:11:37Z'},song:{state:'resolved',active:false,resolvedAt:'2026-10-21T03:11:38Z'}}};
 assert.equal(historyRuntimeBlocked(blocks,2026,q.tasks).size,0);assert(selectHistorySessionWork(q,{blocks}).ids.some(id=>id.startsWith('win|')));win.lastAttemptAt='2026-10-21T03:31:00Z';assert.deepEqual([...historyRuntimeBlocked(blocks,2026,q.tasks)],['win']);const s=selectHistorySessionWork(q,{blocks});assert(s.ids.every(id=>!id.startsWith('win|')));assert(q.tasks.some(t=>t.platform==='win'&&t.state==='pending'));assert.equal(q.tasks.length,1080);
});
test('dynamic task filter stops a newly expired site inside the same held-lock cycle and retains its other months',async()=>{
 let state=null,released=false;const attempted=[];
 await runHistoryBackfill({year:2026,today,platforms:['win','qz'],kinds:['members'],data:{},coveredSources:[],availability:{platforms:{}},now,clock:()=>1000,maxRunMs:600000,maxTaskMs:180000,maxPrimaryTasks:100000,maxOptionalTasks:0,lock:async()=>async()=>{released=true;},readState:async()=>state,writeState:async s=>{state=clone(s);},taskFilter:(t,s)=>!historyRuntimeBlocked(null,2026,s.tasks).has(t.platform),executeTask:async t=>{attempted.push(t);if(t.platform==='win')throw Object.assign(Error('private'),{code:'login_required'});return{ok:true,sources:[{file:'qz-members.json',from:t.from,through:t.through,capturedAt:stamp}]};}});
 assert.equal(attempted.filter(t=>t.platform==='win').length,1);assert.equal(attempted.filter(t=>t.platform==='qz').length,9);assert.equal(state.tasks.length,18);assert.equal(state.tasks.filter(t=>t.platform==='win'&&t.state==='pending').length,8);assert(released);
});
test('cycle gives backfill the full queue plan, bounds work, releases before overlay, verifies publication before atomic local persistence',async()=>{
 const f=fixture();const run=f.options.runBackfill;f.options.runBackfill=async opts=>{assert.equal(opts.maxRunMs,600000);assert.equal(opts.maxTaskMs,180000);assert.equal(opts.platforms,undefined);assert.equal(opts.kinds,undefined);assert.equal(typeof opts.taskFilter,'function');return run(opts);};const r=await runHistorySessionCycle(f.options);
 assert.equal(r.status,'published');assert.equal(r.attempted,1);assert.equal(f.reads,2);assert(f.events.indexOf('release')<f.events.indexOf('overlay'));assert(f.events.indexOf('publish')<f.events.indexOf('persist'));assert.equal(f.events.at(-1),'status');assert.equal(f.status.unpublishedAttemptStartedAt,null);assert.equal(f.queue.tasks.length,1080);
});
test('publish failure retains the original outbox boundary and never writes D or exposes secrets',async()=>{
 const f=fixture({publish:async()=>{throw Error('HTTP403 PRIVATE_TOKEN');}});const r=await runHistorySessionCycle(f.options);assert.equal(r.status,'failed');assert.equal(r.error,'session_publish_failed');assert.equal(f.status.unpublishedAttemptStartedAt,stamp);assert(!f.events.includes('persist'));assert.equal(f.dashboard.version,'base');assert.doesNotMatch(JSON.stringify(r),/PRIVATE_TOKEN|HTTP403/);
 const again=await runHistorySession({runCycle:async()=>r,stopping:async()=>false,maxCycles:100});assert.equal(again.cycles,1);assert.equal(again.status,'failed');
});
test('failed token/receipt/local persistence cannot clear the unpublished boundary',async()=>{
 for(const stage of ['token','receipt','persist']){const f=fixture(stage==='token'?{readToken:async()=>{throw Error('secret');}}:stage==='receipt'?{publish:async()=>({ok:true,sha256:'wrong'})}:{persist:async()=>{throw Error('private path');}});const r=await runHistorySessionCycle(f.options);assert.equal(r.status,'failed');assert.equal(f.status.unpublishedAttemptStartedAt,stamp);if(stage!=='persist')assert(!f.events.includes('persist'));assert.equal(r.error,stage==='token'?'session_token_unavailable':stage==='persist'?'session_persist_failed':'session_publish_failed');}
});
test('publication retry rebuilds against latest D with original attempt boundary and performs no browser work',async()=>{
 const original='2026-10-21T02:00:00Z',f=fixture({runBackfill:async()=>assert.fail('retry must not collect')});f.status={unpublishedAttemptStartedAt:original,error:'session_publish_failed'};let reads=0;f.options.readDashboard=async()=>base(++reads===1?'first':'latest-newer');f.options.overlay=async opts=>{assert.equal(opts.attemptStartedAt,original);assert.equal(opts.previous.version,'latest-newer');return{...opts.previous,update:{statusOnly:true,partial:true,updatedDomains:[]}};};const r=await runHistorySessionCycle(f.options);assert.equal(r.status,'published');assert.equal(r.phase,'publish_retry');assert.equal(r.statusOnly,true);assert.equal(f.dashboard.version,'latest-newer');assert.equal(f.status.unpublishedAttemptStartedAt,null);assert.equal(f.status.error,null);
});
test('no source/status change skips token and publication; collector busy never enters overlay',async()=>{
 const f=fixture({overlay:async()=>null,readToken:async()=>assert.fail('no token needed')});const r=await runHistorySessionCycle(f.options);assert.equal(r.status,'no_change');assert(!f.events.includes('persist'));assert.equal(f.status.unpublishedAttemptStartedAt,null);
 const busy=fixture({runBackfill:async()=>({busy:true}),overlay:async()=>assert.fail('busy must not compile')});assert.equal((await runHistorySessionCycle(busy.options)).status,'collector_busy');assert.equal(busy.status.unpublishedAttemptStartedAt,null);
});
test('stopfile is checked before any local base, queue or browser work and between cycles',async()=>{
 const f=fixture({stopping:async()=>true,readDashboard:async()=>assert.fail('stopped')});assert.equal((await runHistorySessionCycle(f.options)).status,'stopped');assert.equal(f.writes.length,0);let stopped=false,calls=0;const r=await runHistorySession({stopping:async()=>stopped,runCycle:async()=>{calls++;stopped=true;return{status:'published'};}});assert.equal(r.status,'stopped');assert.equal(calls,1);
});
test('driver is bounded to 100 new cycles and does not retry publication failures',async()=>{
 let calls=0;const r=await runHistorySession({maxCycles:100,stopping:async()=>false,runCycle:async()=>{calls++;return{status:'published'};}});assert.equal(calls,100);assert.equal(r.status,'max_cycles');let time=0;const sleeps=[];const waiting=await runHistorySession({maxCycles:2,stopping:async()=>false,now:()=>time,sleep:async ms=>{sleeps.push(ms);time+=ms;},runCycle:async()=>({status:'waiting',nextRetryAt:new Date(120000).toISOString()})});assert.equal(waiting.cycles,2);assert(sleeps.every(ms=>ms<=15000));assert.equal(sleeps.reduce((a,b)=>a+b,0),120000);
});
test('each spawned cycle uses a new hidden node and forwards only whitelisted summaries, not arbitrary stdout',async()=>{
 const children=[],input=[];const spawnChild=(node,args,options)=>{const c=new EventEmitter();c.stdout=new EventEmitter();c.stderr=new EventEmitter();c.stdin={end:body=>{input.push(JSON.parse(body));queueMicrotask(()=>{c.stdout.emit('data',Buffer.from('PRIVATE_RAW\nHISTORY_SESSION_RESULT '+JSON.stringify({schema:1,status:'published',published:true,sha256:sha,token:'PRIVATE_TOKEN',rows:['PRIVATE_AID']})+'\n'));c.emit('close',0);});}};children.push({node,args,options,c});return c;};for(let i=0;i<2;i++){const r=await spawnHistorySessionCycle({year:2026,cycleMs:600000,root:'fixture-root'},{spawnChild,nodePath:'node-fixture'});assert.equal(r.status,'published');assert.doesNotMatch(JSON.stringify(r),/PRIVATE_/);}assert.equal(children.length,2);assert(children.every(c=>c.options.windowsHide===true&&c.args.at(-1)==='--cycle'));assert(input.every(v=>!Object.hasOwn(v,'token')));
});
test('timeout and invalid child output fail safely; no lock is removed by the parent',async()=>{
 const spawnChild=()=>{const c=new EventEmitter();c.stdout=new EventEmitter();c.stderr=new EventEmitter();c.stdin={end:()=>{}};c.kill=()=>{queueMicrotask(()=>c.emit('close',null));};return c;};const r=await spawnHistorySessionCycle({cycleMs:11000},{spawnChild,timeoutMs:5});assert.equal(r.error,'session_child_timeout');
});
function memberRaw(platform='win'){return{platform,from:'2026-02-01',through:'2026-02-28',sourceUrl:`https://${platform==='win'?'admin.winmalo.com:9955':'admin.song-yy.com:9955'}/player/list`,capturedAt:stamp,complete:true,scope:'created_in_period',totalRows:1,header:['AID','暱稱','創帳時間'],rows:[['000001','member','2026-02-03 12:00:00']],queryProof:{verified:true,selectedFrom:'2026-02-01',selectedThrough:'2026-02-28',freshResultVerified:true,filtersVerified:true},paginationProof:{pageSize:1000,totalRows:1,pages:[{page:1,rowCount:1}]}};}
test('complete Feb raw member captures seed Win/Song without independent registration; malformed evidence stays pending',async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'history-session-members-'));try{const files=[];for(const platform of ['win','song']){const file=`members-${platform}-2026-02-01_2026-02-28-asof-20261021.json`;files.push(file);await fs.writeFile(path.join(dir,file),JSON.stringify(memberRaw(platform)));}const sources=await validatedHistoryMemberCoverage(dir,{today});assert.equal(sources.length,2);const plan=createHistoryPlan({year:2026,today}),state=mergeHistoryState(plan,null,{coveredSources:sources});for(const platform of ['win','song'])assert.equal(state.tasks.find(t=>t.id===`${platform}|2026-02|members`).state,'succeeded');
  for(const mutate of [r=>{r.complete=false;},r=>{r.sourceUrl='https://wrong.invalid/player/list';},r=>{r.queryProof.selectedFrom='2026-02-02';},r=>{r.paginationProof.pages=[];},r=>{r.rows[0][2]='2026-03-01';}]){const raw=memberRaw();mutate(raw);await fs.writeFile(path.join(dir,files[0]),JSON.stringify(raw));assert.equal((await validatedHistoryMemberCoverage(dir,{today})).filter(s=>s.platform==='win').length,0);}
 }finally{await fs.rm(dir,{recursive:true,force:true});}
});
test('dashboard member capture completeness is independent of classification completeness but still requires exact source identity',()=>{
 const source={file:'members-win-2026-02-01_2026-02-28-asof-20261021.json',from:'2026-02-01',through:'2026-02-28',capturedAt:stamp,complete:true},data={memberComposition:[{platform:'win',cohortCoverage:{complete:false},sources:[source,{...source,complete:false},{...source,file:source.file.replace('win','song')},{...source,from:'2026-02-02'}]}]};const coverage=historyCoverageFromDashboard(data);assert.equal(coverage.length,1);assert.equal(coverage[0].kind,'members');
});
test('seed-only changes are persisted by a zero-work filtered cycle, not mistaken for already completed queue',async()=>{
 const f=fixture();for(const task of f.queue.tasks)task.state='succeeded';const task=f.queue.tasks.find(t=>t.id==='win|2026-02|members');task.state='failed';task.lastError='query_result_timeout';task.attempts=2;f.options.readMemberCoverage=async()=>[{platform:'win',kind:'members',file:'members-win-2026-02-01_2026-02-28-asof-20261021.json',from:task.from,through:task.through,capturedAt:stamp,complete:true,verified:true}];f.options.runBackfill=async opts=>{assert.equal(opts.taskFilter(task,f.queue),false);f.queue=mergeHistoryState(createHistoryPlan({year:2026,today}),f.queue,{coveredSources:opts.coveredSources});f.events.push('release');return{busy:false,lastCycle:{attemptedIds:[]}};};const r=await runHistorySessionCycle(f.options);assert.equal(r.status,'published');assert.equal(r.attempted,0);assert.equal(f.queue.tasks.find(t=>t.id===task.id).state,'succeeded');
});
test('CLI caps, duplicate/secret arguments and unsafe output are rejected or stripped',()=>{
 assert.equal(parseHistorySessionArguments(['--run','--year','2026','--max-cycles','100','--cycle-ms','600000']).mode,'run');for(const args of [['--run','--plan'],['--year','2026','--year','2026'],['--max-cycles','101'],['--cycle-ms','600001'],['--token','private'],['--year','nonsense']])assert.throws(()=>parseHistorySessionArguments(args));const safe=safeHistorySessionResult({status:'failed',error:'TOKEN_IN_ERROR',token:'PRIVATE',counts:{pending:3,private:99},blockedPlatforms:['win','bad'],rows:['AID'],sha256:'bad'});assert.equal(safe.error,'session_cycle_failed');assert.deepEqual(safe.counts,{pending:3});assert.doesNotMatch(JSON.stringify(safe),/PRIVATE|AID|TOKEN_IN_ERROR/);
});
