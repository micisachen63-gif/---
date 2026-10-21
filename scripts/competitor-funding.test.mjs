// LEGACY_RATE_FIXTURE: injected 133/144 or alternate divisors test historical/custom DTO compatibility; current production rates come only from merchant-rates.json.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {parseCompetitorFundingSource,parseCompetitorCashSource,analyzeCompetitorFunding,buildCompetitorFunding,COMPETITOR_SCENARIO_ROSTER} from './competitor-funding.mjs';
const HEADER=['名次','贈禮AID','贈禮暱稱','對象AID','對象暱稱','贈禮總金額','差額'],CASH_HEADER=['日期','DAU','DPU','總筆數','總金額','儲值率','ARPU','ARPPU','首儲人數','首儲總額'];
const HOST={o8:'8o8.tw',aos:'aos888.com',fcc:'fcc99.com',cgb:'cgb777.com'},ROSTER={o8:[{aid:'m1',nickname:'hypothesis one'},{aid:'m2',nickname:'hypothesis two'}],aos:[{aid:'m1',nickname:'different platform'}],fcc:[],cgb:[]},POLICY={method:'coins/divisor',rates:{o8:{buyDivisor:133,sellDivisor:144},aos:{buyDivisor:1.1,sellDivisor:1.11}}};
function source(edges,{platform='o8',month='2026-10',through=month+'-20',pageSize=1000,local=false,capturedAt='2026-10-21T01:00:00Z',...extra}={}){
 const amounts=new Map(edges.map(([a,b,n])=>[JSON.stringify([a,b]),n]));
 const rows=edges.map(([a,b,n],i)=>[String(local?i%pageSize+1:i+1),a,'name '+a,b,'name '+b,String(n),String(n-(amounts.get(JSON.stringify([b,a]))??0))]);
 const pages=Array.from({length:Math.max(1,Math.ceil(rows.length/pageSize))},(_,i)=>{const count=Math.min(pageSize,Math.max(0,rows.length-i*pageSize)),start=local?1:i*pageSize+1;return{page:i+1,rowCount:count,firstRank:count?String(start):null,lastRank:count?String(start+count-1):null,...(local?{rankMode:'page-local',selectedPageVerified:true}:{})};});
 return{file:`competitor-period-rank-${platform}-${month}-01_${through}.json`,data:{platform,from:month+'-01',through,capturedAt,sourceUrl:`https://admin.${HOST[platform]}:9955/statements/giving`,tab:'贈禮排行',header:HEADER,rows,totalRows:rows.length,complete:true,currentDayPartial:false,recentOnlyRestriction:false,queryProof:{selectedFrom:month+'-01',selectedThrough:through,verified:true},paginationProof:{pageSize,totalRows:rows.length,pages},...extra}};
}
function cash(platform='o8',month='2026-10',amount=10){return{file:`competitor-cash-range-${platform}-${month}-01_${month}-20.json`,data:{platform,from:month+'-01',through:month+'-20',capturedAt:'2026-10-21T01:00:00Z',sourceUrl:`https://admin.${HOST[platform]}:9955/statements/player-summary`,tab:'玩家消費',header:CASH_HEADER,rows:[...Array.from({length:20},(_,i)=>[month+'-'+String(i+1).padStart(2,'0'),'10','2','3',String(amount),'20%','1','2','1','1']),['總和','200','40','60',String(amount*20)],['平均','10','2','3',String(amount)]],complete:true,queryProof:{selectedFrom:month+'-01',selectedThrough:month+'-20',verified:true}}};}
const cashSources=(platform='o8')=>({[platform]:['2026-09','2026-10'].map(m=>{const s=cash(platform,m);return parseCompetitorCashSource(s.file,s.data);})});
const analyze=(reports,opts={})=>analyzeCompetitorFunding(reports,{asOf:'2026-10-21',candidateRoster:ROSTER,policy:POLICY,cashSources:cashSources(),...opts});
const own=x=>x.platforms.find(p=>p.platform==='o8');

test('fixed hypothesis roster is explicit, scoped, frozen and never confirmed',()=>{
 assert.equal(Object.values(COMPETITOR_SCENARIO_ROSTER).reduce((s,r)=>s+r.length,0),22);assert.equal(COMPETITOR_SCENARIO_ROSTER.o8.some(r=>r.aid==='90000000004'),false);assert.equal(Object.isFrozen(COMPETITOR_SCENARIO_ROSTER.o8[0]),true);
 const p=own(analyze([]));assert.equal(p.officialRevenue,null);assert.equal(p.includeInActualRevenue,false);assert.equal(p.includedMerchants.every(m=>m.verified===false),true);assert.equal(p.previous.rosterVersion,p.current.rosterVersion);
});
test('directional give counted once, reverse is distinct, internal transfers excluded, rates remain 133/144',()=>{
 const s=source([['m1','p',1330],['p','m1',720],['m1','m2',999],['m2','m1',111]]);s.data.rows.push([...s.data.rows[0]]);s.data.rows.at(-1)[0]='5';s.data.totalRows=5;s.data.paginationProof.totalRows=5;s.data.paginationProof.pages[0]={page:1,rowCount:5,firstRank:'1',lastRank:'5'};
 const before=structuredClone(s),p=own(analyze([s])),r=p.current;
 assert.equal(r.buyCoins,1330);assert.equal(r.sellCoins,720);assert.equal(r.buyAmount,10);assert.equal(r.sellAmount,5);assert.equal(r.excludedInternalCoins,1110);assert.equal(r.excludedInternalPairs,2);assert.equal(r.scenarioRevenue,205);assert.equal(r.officialRevenue,null);assert.equal(r.source.validation.duplicatePairs,1);assert.deepEqual(s,before);
});
test('page-local ranks accepted only with independently verified selected page and all pages present',()=>{
 const s=source([['m1','a',1],['m1','b',2],['m1','c',3]],{pageSize:2,local:true});
 assert.equal(parseCompetitorFundingSource(s.file,s.data).complete,true);
 const bad=structuredClone(s);bad.data.paginationProof.pages[1].selectedPageVerified=false;assert.equal(parseCompetitorFundingSource(bad.file,bad.data).complete,false);
 const missing=structuredClone(s);missing.data.paginationProof.pages.pop();assert.equal(parseCompetitorFundingSource(missing.file,missing.data).complete,false);
});
test('period date, row count, page sequence, selected proof, restricted access, header and directed net validated independently',()=>{
 const base=source([['m1','a',10],['a','m1',3]]);
 for(const mutate of [s=>{s.data.queryProof.verified=false;},s=>{s.data.queryProof.selectedThrough='2026-10-19';},s=>{s.data.paginationProof.totalRows++;},s=>{s.data.paginationProof.pages[0].rowCount--;},s=>{s.data.paginationProof.pages[0].page=2;},s=>{s.data.rows[0][0]='3';},s=>{s.data.recentOnlyRestriction=true;},s=>{s.data.header=HEADER.slice(1);},s=>{s.data.rows[0][6]='10';},s=>{s.data.complete=false;},s=>{s.data.sourceUrl='https://admin.aos888.com:9955/statements/giving';}]){
  const s=structuredClone(base);mutate(s);const r=own(analyze([s])).current;assert.equal(r.covered,false);assert.equal(r.buyCoins,null);assert.equal(r.scenarioRevenue,null);assert.equal(r.officialCash,200);
 }
});
test('user-confirmed broadcaster role excluded even if supplied in hypothesis roster, with role flows separated',()=>{
 const roster={...ROSTER,o8:[...ROSTER.o8,{aid:'90000000004',nickname:'broadcaster'}]},s=source([['m1','90000000004',100],['90000000004','m1',20],['m1','player',1330]]),p=own(analyze([s],{candidateRoster:roster}));
 assert.equal(p.includedMerchants.some(m=>m.aid==='90000000004'),false);assert.equal(p.excludedRoles[0].status,'user_confirmed_streamer_role');assert.equal(p.current.buyCoins,1330);assert.equal(p.current.sellCoins,0);assert.equal(p.current.excludedRoleCoins,120);assert.equal(p.current.excludedRolePairs,2);assert.equal(p.officialRevenue,null);
});
test('complete zero is retained while absent, incomplete and absent-identity data remain null',()=>{
 const zero=own(analyze([source([])]));assert.equal(zero.current.buyCoins,0);assert.equal(zero.current.sellCoins,0);assert.equal(zero.current.scenarioRevenue,200);
 const missing=own(analyze([]));assert.equal(missing.current.buyCoins,null);assert.equal(missing.current.officialCash,200);assert.equal(missing.current.scenarioRevenue,null);
 const emptyRoster=own(analyze([source([])],{candidateRoster:{}}));assert.equal(emptyRoster.current.buyCoins,null);assert.equal(emptyRoster.current.covered,false);
});
test('partial date snapshots are never promoted after midnight; observed amounts stay separately labelled',()=>{
 const s=source([['m1','p',133]],{capturedAt:'2026-10-20T12:00:00Z',currentDayPartial:true});
 const r=own(analyze([s])).current;assert.equal(r.covered,false);assert.equal(r.observedBuyCoins,133);assert.equal(r.buyCoins,null);assert.equal(r.scenarioRevenue,null);assert.equal(r.partial,true);
});
test('cash uses exact verified daily range, excludes sum/average, and validates missing dates, closure and distinct source time',()=>{
 const s=cash(),parsed=parseCompetitorCashSource(s.file,s.data);assert.equal(parsed.rows.length,20);assert.equal(parsed.validation.valid,true);
 const r=own(analyze([source([])],{cashSources:{o8:[parsed]}})).current;assert.equal(r.officialCash,200);assert.equal(r.cashSource.complete,true);
 for(const mutate of [x=>{x.data.rows.splice(0,1);},x=>{x.data.queryProof.verified=false;},x=>{x.data.capturedAt='2026-10-20T12:00:00Z';},x=>{x.data.rows[0][4]='';},x=>{x.data.sourceUrl='https://admin.aos888.com:9955/statements/player-summary';}]){
  const bad=structuredClone(s);mutate(bad);const x=own(analyze([source([])],{cashSources:{o8:[parseCompetitorCashSource(bad.file,bad.data)]}}));assert.equal(x.current.officialCash,null);assert.equal(x.current.scenarioRevenue,null);assert.equal(x.current.buyCoins,0);
 }
});
test('unknown rates keep raw coins and official cash without fabricating scenario amounts',()=>{
 const r=own(analyze([source([['m1','p',133]])],{policy:{method:'coins/divisor',rates:{}}})).current;assert.equal(r.buyCoins,133);assert.equal(r.buyAmount,null);assert.equal(r.sellAmount,null);assert.equal(r.officialCash,200);assert.equal(r.scenarioRevenue,null);
});
test('same-period fixed-cohort comparisons include buy, sell, cash and scenario differences without changing official revenue',()=>{
 const x=own(analyze([source([['m1','p',1330],['p','m1',720]],{month:'2026-09'}),source([['m1','p',2660],['p','m1',1440]])]));
 assert.equal(x.change.comparable,true);assert.equal(x.change.buyCoins,1330);assert.equal(x.change.sellCoins,720);assert.equal(x.change.buyAmount,10);assert.equal(x.change.sellAmount,5);assert.equal(x.change.scenarioRevenue,5);assert.equal(x.change.buyRate,1);assert.equal(x.officialRevenue,null);
 const absent=own(analyze([source([])]));assert.equal(absent.change.comparable,false);assert.equal(absent.change.buyCoins,null);assert.equal(absent.change.scenarioRevenue,null);
});
test('independently covered official cash can compare even when merchant source is missing',()=>{
 const sources=cashSources();for(const r of sources.o8.find(s=>s.from==='2026-10-01').rows)r[4]=20;
 const p=own(analyze([],{cashSources:sources}));assert.equal(p.change.comparable,false);assert.equal(p.change.cashComparable,true);assert.equal(p.change.officialCash,200);assert.equal(p.change.cashRate,1);assert.equal(p.change.revenueComparable,false);assert.equal(p.change.scenarioRevenue,null);assert.equal(p.change.buyRate,null);
});
test('negative scenario baseline keeps signed amount difference without a misleading percentage',()=>{
 const p=own(analyze([source([['p','m1',144000]],{month:'2026-09'}),source([])]));assert.equal(p.previous.scenarioRevenue,-800);assert.equal(p.current.scenarioRevenue,200);assert.equal(p.change.scenarioRevenue,1000);assert.equal(p.change.scenarioRevenueRate,null);
});
test('same AID on another platform never inherits a hypothesis identity or flow',()=>{
 const x=analyze([source([['m2','p',133]],{platform:'aos'})],{cashSources:cashSources('aos')});const aos=x.platforms.find(p=>p.platform==='aos');assert.equal(aos.current.buyCoins,0);assert.equal(aos.current.sellCoins,0);assert.equal(aos.includedMerchants.length,1);assert.equal(own(x).current.buyCoins,null);
});
test('new graph patterns can be reviewed but never change fixed roster or scenario arithmetic',()=>{
 const edges=[];for(let i=0;i<25;i++){edges.push(['new-pattern','peer-'+i,10]);if(i<6)edges.push(['peer-'+i,'new-pattern',5]);}
 const x=own(analyze([source(edges,{month:'2026-09'}),source(edges)]));assert.equal(x.possibleAdditionalCandidates.find(c=>c.aid==='new-pattern').seenInBothPeriods,true);assert.equal(x.possibleAdditionalCandidates[0].includedInScenario,false);assert.equal(x.includedMerchants.some(m=>m.aid==='new-pattern'),false);assert.equal(x.current.buyCoins,0);assert.equal(x.current.sellCoins,0);
});
test('builder reads only new monthly sources and verified cash-range files, keeps missing o8 cash independently',async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'competitor-scenario-')),coin=source([['m1','p',1330]]),c=cash(),old='gift-rank-o8-2026-10-14_2026-10-20.json',files=[coin.file,c.file,old];
 try{await fs.writeFile(path.join(dir,coin.file),JSON.stringify(coin.data));await fs.writeFile(path.join(dir,c.file),JSON.stringify(c.data));await fs.writeFile(path.join(dir,old),'must not read this old prefix');
  const before=(await fs.readdir(dir)).sort(),x=await buildCompetitorFunding(dir,{policy:POLICY,candidateRoster:ROSTER,asOf:'2026-10-21',competitors:[]});assert.equal(own(x).current.buyCoins,1330);assert.equal(own(x).current.officialCash,200);assert.equal(x.sourceReadErrors.length,0);assert.deepEqual((await fs.readdir(dir)).sort(),before);
 }finally{for(const f of files)await fs.unlink(path.join(dir,f));await fs.rmdir(dir);}
});
