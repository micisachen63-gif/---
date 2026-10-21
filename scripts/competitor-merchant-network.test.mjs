import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {parseCompetitorNetworkSource,analyzeCompetitorMerchantNetworks,buildCompetitorMerchantNetwork} from './competitor-merchant-network.mjs';
import {sha256} from './o8-archive-store.mjs';
import {validateCompetitorPageFrame} from './competitor-archive-pagination.mjs';

const HEADER=['名次','贈禮AID','贈禮暱稱','對象AID','對象暱稱','贈禮總金額','差額'];
const HOSTS={o8:'8o8.tw',aos:'aos888.com',fcc:'fcc99.com',cgb:'cgb777.com',goldfun:'goldfun88.com',o9:'o9play.com'};
const HUB='90071992547409931234',SECOND='90071992547409935678';
function rows(edges){
 const amounts=new Map(edges.map(([from,to,coins])=>[JSON.stringify([from,to]),coins]));
 return edges.map(([from,to,coins],i)=>[String(i+1),from,from===HUB?'無品牌廣泛帳號':from===SECOND?'普通暱稱':`一般帳號${from}`,to,to===HUB?'無品牌廣泛帳號':to===SECOND?'普通暱稱':`一般帳號${to}`,String(coins),String(coins-(amounts.get(JSON.stringify([to,from]))??0))]);
}
function source(edges,{platform='o8',from='2026-10-14',through='2026-10-20',daily=false,capturedAt='2026-10-20T14:00:00Z',...extra}={}){
 const r=rows(edges);return{file:daily?`gift-daily-rank-${platform}-${from}.json`:`gift-network-week-${platform}-${from}_${through}.json`,data:{platform,from,through,sourceUrl:`https://admin.${HOSTS[platform]}:9955/statements/giving`,tab:'贈禮排行',capturedAt,header:HEADER,rows:r,totalRows:r.length,complete:true,queryProof:{selectedFrom:from,selectedThrough:through,verified:true},...extra}};
}
function broadGraph(){const e=[];for(let i=0;i<25;i++){const p='private-person-'+i;e.push([HUB,p,100+i]);if(i<10)e.push([p,HUB,60+i]);if(i<10){e.push([SECOND,p,30+i]);if(i<4)e.push([p,SECOND,20+i]);}}e.push([HUB,SECOND,40],[SECOND,HUB,50]);return e;}
function strictDay(date,edges=broadGraph(),extra={}){const s=source(edges,{from:date,through:date,daily:true,capturedAt:'2026-10-21T05:00:00Z'}),d=s.data;d.queryProof={...d.queryProof,freshResultVerified:true,baselineSignature:'before',resultSignature:sha256(d.rows),aidFiltersEmpty:true};d.paginationProof={pageSize:1000,totalRows:d.rows.length,pages:[validateCompetitorPageFrame({header:HEADER,rows:d.rows,totalRows:d.rows.length})]};Object.assign(d,extra);return s;}
async function networkWorkspace(t){const live=await fs.mkdtemp(path.join(os.tmpdir(),'network-archive-reader-'));t.after(()=>fs.rm(live,{recursive:true,force:true}));return live;}
async function archiveDay(live,day,source,name='capture.json'){const folder=path.join(live,'competitor-archive/o8/daily',day);await fs.mkdir(folder,{recursive:true});await fs.writeFile(path.join(folder,name),JSON.stringify(source.data));}
const analyze=(reports,asOf='2026-10-20')=>analyzeCompetitorMerchantNetworks(reports,{asOf});
const own=x=>x.platforms.find(p=>p.platform==='o8');

test('daily immutable snapshots refresh the latest derived week; a flat mirror is selected once and never adds edges again',async t=>{const live=await networkWorkspace(t);for(let day=14;day<=20;day++){const date=`2026-10-${day}`,s=strictDay(date);await archiveDay(live,date,s);if(day===14)await fs.writeFile(path.join(live,s.file),JSON.stringify(s.data));}const old=source(broadGraph());await fs.writeFile(path.join(live,old.file),JSON.stringify(old.data));const result=own(await buildCompetitorMerchantNetwork(live,{asOf:'2026-10-21'})),base=own(analyze([source(broadGraph())])).candidates.find(c=>c.aid===HUB);assert.equal(result.derived,true);assert.equal(result.dataBasis,'derived_from_7_verified_closed_daily_rankings');assert.equal(result.coverage.weekly.derived,true);assert.equal(result.coverage.weekly.dateProofVerified,false);assert.equal(result.coverage.weekly.sourceReferences.length,7);assert(result.coverage.weekly.sourceReferences.every(r=>r.queryProof.selectedFrom===r.date&&r.queryProof.selectedThrough===r.date&&r.queryProof.verified));assert.equal(result.candidates.find(c=>c.aid===HUB).weekly.out,base.weekly.out*7);assert.equal(result.coverage.dailyCompleteDays.length,7);assert.equal(result.coverage.dailyWeeklyReconciliation.status,'match');});

test('a missing or invalid immutable day cannot manufacture a complete derived window',async t=>{for(const mutate of [null,d=>d.sourceUrl='https://admin.aos888.com:9955/statements/giving',d=>d.queryProof.selectedFrom='2026-10-13',d=>d.paginationProof.pages[0].rowSha256='bad']){const live=await networkWorkspace(t),old=source(broadGraph());await fs.writeFile(path.join(live,old.file),JSON.stringify(old.data));for(let day=14;day<=20;day++){const date=`2026-10-${day}`,s=strictDay(date);if(day===17){if(!mutate)continue;mutate(s.data);}await archiveDay(live,date,s);}const result=own(await buildCompetitorMerchantNetwork(live,{asOf:'2026-10-21'}));assert.equal(result.derived,false);assert.equal(result.dataBasis,'backend_weekly_ranking_snapshot');assert.equal(result.coverage.latestClosedWindow.complete,false);assert.deepEqual(result.coverage.latestClosedWindow.missingDates,['2026-10-17']);}});

test('equal total with changed directional pairs selects the newer full snapshot rather than summing or comparing totals only',async t=>{const live=await networkWorkspace(t),changed=broadGraph().map(([a,b,v])=>[a.startsWith('private-person-')?a+'-changed':a,b.startsWith('private-person-')?b+'-changed':b,v]);for(let day=14;day<=20;day++){const date=`2026-10-${day}`;await archiveDay(live,date,strictDay(date,day===14?changed:broadGraph()));}const old=strictDay('2026-10-14');old.data.capturedAt='2026-10-21T04:00:00Z';await fs.writeFile(path.join(live,old.file),JSON.stringify(old.data));const result=own(await buildCompetitorMerchantNetwork(live,{asOf:'2026-10-21'})),hub=result.candidates.find(c=>c.aid===HUB);assert.equal(result.derived,true);assert.equal(hub.weekly.uniqueCounterparties,51);assert.equal(new Set(result.coverage.weekly.sourceReferences.map(r=>r.date)).size,7);});

test('directional pairs deduplicate without counting net delta or reverse twice; AIDs stay exact',()=>{
 const s=source([[HUB,SECOND,100],[SECOND,HUB,60]]);s.data.rows.push([...s.data.rows[0]]);s.data.totalRows++;
 const p=parseCompetitorNetworkSource(s.file,s.data);
 assert.equal(p.complete,true);assert.equal(p.edges.size,2);assert.equal(p.validation.duplicatePairs,1);
 assert.equal(p.edges.get(JSON.stringify([HUB,SECOND])).coins,100);assert.equal(p.names.has(HUB),true);
 assert.equal([...p.edges.values()].reduce((sum,e)=>sum+e.coins,0),160);
});

test('conflicting duplicates, wrong delta, invalid cash, missing columns and wrong totals are rejected',()=>{
 const base=source([[HUB,SECOND,100],[SECOND,HUB,60]]);
 for(const mutate of [s=>{s.data.rows.push([...s.data.rows[0]]);s.data.rows.at(-1)[5]='101';s.data.totalRows++;},s=>{s.data.rows[0][6]='100';},s=>{s.data.rows[0][5]='';},s=>{s.data.header=HEADER.filter(h=>h!=='贈禮AID');},s=>{s.data.totalRows++;}]){
  const s=structuredClone(base);mutate(s);assert.equal(parseCompetitorNetworkSource(s.file,s.data).complete,false);
 }
});

test('date proof is independent from row totals and source must be exact owned report',()=>{
 const base=source(broadGraph());
 for(const mutate of [s=>{s.data.queryProof.verified=false;},s=>{s.data.queryProof.selectedFrom='2026-10-15';},s=>{s.data.through='2026-10-19';},s=>{s.data.sourceUrl='https://admin.aos888.com:9955/statements/giving';},s=>{s.data.sourceUrl='https://admin.8o8.tw:9955/player/list';},s=>{s.data.tab='收禮排行';},s=>{s.data.capturedAt='2026-10-19T12:00:00Z';},s=>{s.data.complete=false;}]){
  const s=structuredClone(base);mutate(s);const p=own(analyze([s]));assert.equal(p.coverage.weekly.complete,false);assert.equal(p.candidates.length,0);
 }
});

test('broad bidirectional hubs and shared-peer subhub are selected without using merchant names',()=>{
 const s=source(broadGraph()),original=structuredClone(s),p=own(analyze([s]));
 assert.equal(p.candidates.find(c=>c.aid===HUB).classification,'primary_intermediary');
 assert.equal(p.candidates.find(c=>c.aid===SECOND).classification,'possible_subhub');
 const sub=p.candidates.find(c=>c.aid===SECOND);assert.equal(sub.hubRelations.sharedCounterparties[0].count,10);
 assert.equal(sub.hubRelations.transferCoins,90);assert.ok(sub.hubRelations.transferShare>0);
 assert.equal(p.edges.length,2);assert.deepEqual(new Set(p.edges.map(e=>e.coins)),new Set([40,50]));
 assert.equal(p.observedSubgroups.length,1);assert.match(p.observedSubgroups[0].interpretation,/不代表同一實控人/);
 assert.deepEqual(s,original);for(const c of p.candidates){assert.equal(c.verified,false);assert.equal(c.includeInRevenue,false);}
});

test('full-day active count excludes today and missing days are unknown rather than zero',()=>{
 const reports=[source(broadGraph())];
 for(const day of ['14','15','16','17','18','19'])reports.push(source(day==='18'?[]:[[HUB,'private-person-1',Number(day)]],{daily:true,from:`2026-10-${day}`,through:`2026-10-${day}`}));
 reports.push(source([[HUB,'private-person-1',900]],{daily:true,from:'2026-10-20',through:'2026-10-20',currentDayPartial:true}));
 const p=own(analyze(reports)),c=p.candidates.find(c=>c.aid===HUB);
 assert.equal(p.coverage.weekly.complete,true);assert.equal(p.coverage.weekly.partial,true);
 assert.equal(p.coverage.dailyCompleteDays.length,6);assert.equal(c.daily.activeCompleteDays,5);
 assert.equal(c.confidence,'strong');assert.deepEqual(c.daily.series.find(x=>x.date==='2026-10-18'),{date:'2026-10-18',out:0,in:0,active:false,complete:true});
 assert.equal(c.daily.todayPartialActivity.out,900);assert.equal(p.coverage.todayPartial.partial,true);
 assert.equal(p.coverage.dailyWeeklyReconciliation.status,'partial_noncomparable');
 const absent=own(analyze([reports[0]]));assert.equal(absent.candidates[0].daily.activeCompleteDays,null);assert.equal(absent.candidates[0].daily.series.length,0);assert.equal(absent.coverage.missingCompleteDays.length,6);
});

test('platform last capture reflects valid daily sources while weekly snapshot keeps its own time',()=>{
 const week=source(broadGraph(),{capturedAt:'2026-10-20T13:00:00Z'}),day=source([[HUB,SECOND,1]],{daily:true,from:'2026-10-20',through:'2026-10-20',capturedAt:'2026-10-20T14:00:00Z'}),bad=source([],{daily:true,from:'2026-10-19',through:'2026-10-19',capturedAt:'2026-10-20T15:00:00Z',complete:false});
 const p=own(analyze([week,day,bad]));assert.equal(p.capturedAt,'2026-10-20T14:00:00Z');assert.equal(p.coverage.weekly.capturedAt,'2026-10-20T13:00:00Z');
});

test('a complete flag on current day never makes that day eligible as a closed day',()=>{
 const today=source([[HUB,SECOND,5]],{daily:true,from:'2026-10-20',through:'2026-10-20',partial:false});
 const p=own(analyze([source(broadGraph()),today]));assert.equal(p.coverage.dailyCompleteDays.length,0);assert.equal(p.coverage.todayPartial.partial,true);assert.equal(p.candidates[0].daily.todayPartialActivity.partial,true);
});

test('incomplete or unverified daily observations are excluded, with coverage retained',()=>{
 const bad=source([[HUB,SECOND,5]],{daily:true,from:'2026-10-14',through:'2026-10-14',complete:false});
 const p=own(analyze([source(broadGraph()),bad]));assert.equal(p.coverage.dailyCompleteDays.length,0);assert.equal(p.coverage.invalidDailySources.length,1);assert.equal(p.candidates[0].daily.activeCompleteDays,null);
});

test('name and large volume remain explicitly insufficient watch evidence, without leaking counterpart rows',()=>{
 const s=source([...broadGraph(),['金庫-claimed','private-sensitive-id',9999999999]]);
 s.data.rows.at(-1)[2]='超級金庫金控';s.data.rows.at(-1)[4]='一般會員真姓名';
 const p=own(analyze([s])),json=JSON.stringify(p);
 assert.equal(p.candidates.some(c=>c.aid==='金庫-claimed'),false);const watch=p.weakEvidence.find(c=>c.aid==='金庫-claimed');assert.equal(watch.observationKind,'name_volume_insufficient');assert.equal(watch.confidence,'weak');assert.equal(watch.verified,false);
 assert.ok(p.excludedProfiles.narrowHighVolumeAccounts>0);assert.equal(json.includes('private-sensitive-id'),false);assert.equal(json.includes('一般會員真姓名'),false);assert.equal(json.includes('private-person-1'),false);
});

test('generic concentrated distribution and its bidirectional source connection are weak relay observations',()=>{
 const e=[...broadGraph(),['reserve','distributor',10000],['distributor','reserve',5000],['reserve','other',4000],['other','reserve',1000]];
 for(let i=0;i<12;i++)e.push(['distributor','recipient-'+i,10]);
 const p=own(analyze([source(e)])),d=p.weakEvidence.find(c=>c.aid==='distributor'),r=p.weakEvidence.find(c=>c.aid==='reserve');
 assert.equal(d.observationKind,'concentrated_distribution');assert.equal(r.observationKind,'relay_link');assert.equal(d.confidence,'weak');assert.equal(r.confidence,'weak');assert.match(r.counterEvidence.join(' '),/無逐筆先後/);assert.ok(p.edges.some(e=>e.fromAid==='reserve'&&e.toAid==='distributor'));
});

test('multi-hub receipt and one recipient show settlement ambiguity rather than retail merchant identity',()=>{
 const e=[];for(const hub of ['h1','h2','h3']){for(let i=0;i<22;i++){e.push([hub,hub+'-person-'+i,10]);if(i<5)e.push([hub+'-person-'+i,hub,5]);}e.push([hub,'collector',100]);}e.push(['collector','beneficiary',280]);
 const p=own(analyze([source(e)])),c=p.weakEvidence.find(c=>c.aid==='collector');assert.equal(c.observationKind,'consolidating_settlement');assert.equal(c.classification,'watch');assert.match(c.counterEvidence.join(' '),/玩家轉幣/);assert.equal(c.verified,false);assert.equal(c.includeInRevenue,false);
});

test('one-way broad distribution remains a separate uncertain role with counterevidence',()=>{
 const e=Array.from({length:12},(_,i)=>['supplier','recipient-'+i,100]);
 const p=own(analyze([source(e)])),c=p.candidates[0];assert.equal(c.aid,'supplier');assert.equal(c.classification,'one_way_supplier');assert.match(c.counterEvidence.join(' '),/活動派發/);assert.equal(c.confidence,'moderate');assert.equal(c.includeInRevenue,false);
});

test('different funding and distribution counterparties do not need a large net outflow to qualify as supply-pattern evidence',()=>{
 const e=Array.from({length:22},(_,i)=>['supplier','recipient-'+i,100]);
 for(let i=0;i<5;i++)e.push(['funding-'+i,'supplier',440]);
 const p=own(analyze([source(e)])),c=p.candidates.find(c=>c.aid==='supplier');
 assert.equal(c.weekly.out,c.weekly.in);assert.equal(c.classification,'one_way_supplier');assert.equal(c.weekly.bidirectionalCounterparties,0);assert.match(c.evidence.join(' '),/非淨流量/);assert.equal(c.includeInRevenue,false);
});

test('identical nonempty daily payloads limit persistence confidence unless freshness is independently verified',()=>{
 const reports=[source(broadGraph())];for(let day=14;day<=19;day++)reports.push(source([[HUB,SECOND,1]],{daily:true,from:`2026-10-${day}`,through:`2026-10-${day}`}));
 let p=own(analyze(reports));assert.equal(p.coverage.duplicateDailyPayloads.length,6);assert.equal(p.candidates.find(c=>c.aid===HUB).confidence,'moderate');
 for(const s of reports.slice(1))s.data.queryProof.freshResultVerified=true;
 p=own(analyze(reports));assert.equal(p.coverage.duplicateDailyPayloads.length,0);assert.equal(p.candidates.find(c=>c.aid===HUB).confidence,'strong');
});

test('closed weekly directed amounts reconcile only to all aligned complete daily sources',()=>{
 const daily=source([[HUB,SECOND,3],[SECOND,HUB,1]],{daily:true,from:'2026-10-14',through:'2026-10-14'});
 const week=source([[HUB,SECOND,3],[SECOND,HUB,1]],{from:'2026-10-14',through:'2026-10-14'});
 assert.equal(own(analyze([week,daily])).coverage.dailyWeeklyReconciliation.status,'match');
 daily.data.rows=rows([[HUB,SECOND,4],[SECOND,HUB,1]]);
 assert.equal(own(analyze([week,daily])).coverage.dailyWeeklyReconciliation.status,'mismatch');
 assert.equal(own(analyze([week])).coverage.dailyWeeklyReconciliation.status,'missing_daily');
});

test('platform identity isolation, missing sites and input-date validation remain explicit',()=>{
 const reports=[source(broadGraph()),source([[HUB,SECOND,1]],{platform:'aos'})],x=analyze(reports);
 assert.equal(x.platforms.length,6);assert.equal(x.platforms.find(p=>p.platform==='aos').candidates.length,0);assert.equal(x.platforms.find(p=>p.platform==='fcc').coverage.weekly.available,false);
 for(const platform of ['goldfun','o9']){assert.equal(x.platforms.find(p=>p.platform===platform).coverage.weekly.available,false);const s=source([[HUB,SECOND,1]],{platform});assert.equal(parseCompetitorNetworkSource(s.file,s.data).complete,true);s.data.sourceUrl='https://admin.fcc99.com:9955/statements/giving';assert.equal(parseCompetitorNetworkSource(s.file,s.data).complete,false);}
 assert.throws(()=>analyze(reports,'2026-02-30'),/calendar date/);assert.equal(x.platforms.every(p=>p.includeInRevenue===false),true);
});

test('filesystem builder reads only new report prefixes, reports invalid JSON and writes nothing',async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'competitor-network-')),s=source(broadGraph()),files=[s.file,'gift-rank-aos-2026-10-14_2026-10-20.json','gift-daily-rank-cgb-2026-10-14.json'];
 try{
  await fs.writeFile(path.join(dir,files[0]),JSON.stringify(s.data));await fs.writeFile(path.join(dir,files[1]),'this old prefix must not be read');await fs.writeFile(path.join(dir,files[2]),'invalid json');
  const before=(await fs.readdir(dir)).sort(),result=await buildCompetitorMerchantNetwork(dir,{asOf:'2026-10-20'});
  assert.equal(result.platforms[0].coverage.weekly.complete,true);assert.equal(result.platforms[1].coverage.weekly.available,false);assert.deepEqual(result.sourceReadErrors,[{file:files[2],issue:'source_json_unreadable'}]);assert.deepEqual((await fs.readdir(dir)).sort(),before);
 }finally{for(const f of files)await fs.unlink(path.join(dir,f));await fs.rmdir(dir);}
});
