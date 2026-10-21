import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs/promises';import os from 'node:os';import path from 'node:path';
import {parseOwnedCashSource,mergeOwnedCashSources,buildOwnedCashSources,ownedCashEvidence} from './owned-cash-data.mjs';
import {CONFIRMED_MERCHANTS,MERCHANT_IDENTITY_REGISTRY} from './merchant-identities.mjs';
import {parseMerchantPairSnapshot,mergeMerchantFundingWindows,loadCoinConversionPolicy} from './coin-conversion.mjs';
const today='2026-10-21',header=['日期','DAU','DPU','總筆數','總金額','儲值率','ARPU','ARPPU','首儲人數','首儲總額'];
function source(platform='win',from='2026-10-01',through='2026-10-20'){
 const rows=[];for(let t=Date.parse(from);t<=Date.parse(through);t+=86400000)rows.push([new Date(t).toISOString().slice(0,10),'100','10','10','10','10%','0.1','1','1','2']);
 return{platform,from,through,capturedAt:'2026-10-21T01:00:00Z',sourceUrl:`https://${MERCHANT_IDENTITY_REGISTRY.platforms[platform].host}/statements/player-summary`,tab:'玩家消費',header,rows:[...rows,['總和','','','',String(rows.length*10)]],complete:true,calendarCoverageComplete:true,queryProof:{selectedFrom:from,selectedThrough:through,verified:true}};
}
const filename=s=>`owned-cash-range-${s.platform}-${s.from}_${s.through}.json`,parse=s=>parseOwnedCashSource(filename(s),s,{today});

test('new six-site cash captures normalize by header, reconcile footer and close only source-verified dates',()=>{
 for(const platform of Object.keys(CONFIRMED_MERCHANTS)){const raw=source(platform),p=parse(raw);assert.equal(p.complete,true);assert.equal(p.rows.length,20);assert.equal(p.rows[19][4],10);assert.equal(p.rows[0][5],10);assert.equal(p.footerComparison.valid,true);assert.equal(p.calendarCoverageComplete,true);assert.equal(p.rows.some(r=>r[0]==='總和'),false);assert.equal(raw.rows.length,21);}
 const old=source();old.capturedAt='2026-10-20T02:00:00Z';const p=parse(old);assert.equal(p.rows.length,19);assert.deepEqual(p.missingDates,['2026-10-20']);assert.equal(p.calendarCoverageComplete,false);
});

test('sparse complete-visible query stays unknown on absent dates and zero stays known',()=>{
 const raw=source('qz');raw.rows=raw.rows.filter(r=>r[0]!=='2026-10-02'&&r[0]!=='總和');raw.rows[0][4]='0';raw.calendarCoverageComplete=false;const p=parse(raw);assert.equal(p.complete,true);assert.equal(p.rows[0][4],0);assert.deepEqual(p.missingDates,['2026-10-02']);assert.equal(p.footerComparison.available,false);assert.equal(p.calendarCoverageComplete,false);
});

test('incorrect platform, selected dates, footer, duplicate or invalid cash cannot overwrite production daily data',()=>{
 for(const edit of [s=>s.sourceUrl='https://admin.aos888.com:9955/statements/player-summary',s=>s.queryProof.selectedThrough='2026-10-19',s=>s.complete=false,s=>s.rows.at(-1)[4]='999',s=>s.rows.push(s.rows[0]),s=>s.rows[0][4]='',s=>s.capturedAt=null,s=>s.capturedAt='2026-10-22T01:00:00Z']){const raw=source();edit(raw);const p=parse(raw);assert.equal(p.complete,false);const history={win:new Map([['2026-10-01',['2026-10-01',1,1,1,7]]])},times={win:new Map()};mergeOwnedCashSources(history,times,[p]);assert.equal(history.win.size,1);assert.equal(history.win.get('2026-10-01')[4],7);}
});

test('timestamp merge preserves newer dates, older sparse gaps and all independent backend tables',()=>{
 const raw=source('rd'),p=parse(raw),old=['2026-10-01',2,2,2,77],newer=['2026-10-02',3,3,3,99],history={rd:new Map([[old[0],old],[newer[0],newer],['2026-09-30',['2026-09-30',1,1,1,5]]])},times={rd:new Map([[old[0],Date.parse('2026-10-20T01:00Z')],[newer[0],Date.parse('2026-10-21T02:00Z')]])},monthly={consumeMonthly:{rows:[['2026-10',123]]},registrationSource:{through:'2026-10-19'}},before=JSON.stringify(monthly);
 mergeOwnedCashSources(history,times,[p]);assert.equal(history.rd.get(old[0])[4],10);assert.equal(history.rd.get(newer[0])[4],99);assert.equal(history.rd.get('2026-09-30')[4],5);assert.equal(history.rd.size,21);assert.equal(JSON.stringify(monthly),before);assert.notEqual(history.rd.get(old[0]),p.rows[0]);assert.equal(Object.hasOwn(ownedCashEvidence([p])[0],'rows'),false);
});

test('file builder reads only owned cash prefix and never rewrites raw files',async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'owned-cash-')),raw=source('bo'),file=filename(raw),text=JSON.stringify(raw);try{await fs.writeFile(path.join(dir,file),text);await fs.writeFile(path.join(dir,'backend-history-bo.json'),JSON.stringify({preserve:true}));const result=await buildOwnedCashSources(dir,{today});assert.equal(result.length,1);assert.equal(result[0].platform,'bo');assert.equal(await fs.readFile(path.join(dir,file),'utf8'),text);}finally{await fs.unlink(path.join(dir,file));await fs.unlink(path.join(dir,'backend-history-bo.json'));await fs.rmdir(dir);}
});

function pair(platform,month,through,policy){const a=CONFIRMED_MERCHANTS[platform][0],buy=policy.rates[platform].buyDivisor*100,sell=policy.rates[platform].sellDivisor*60,from=month+'-01',raw={platform,from,through,capturedAt:'2026-10-21T01:00Z',sourceUrl:`https://${MERCHANT_IDENTITY_REGISTRY.platforms[platform].host}/statements/giving`,tab:'贈禮排行',header:['名次','贈禮AID','贈禮暱稱','對象AID','對象暱稱','贈禮總金額','差額'],rows:[['1',a,'merchant','player','player',String(buy),String(buy-sell)],['2','player','player',a,'merchant',String(sell),String(sell-buy)]],totalRows:2,complete:true,currentDayPartial:false,queryProof:{selectedFrom:from,selectedThrough:through,verified:true}};return{raw,parsed:parseMerchantPairSnapshot(raw,`gift-rank-${platform}-${from}_${through}.json`)};}
test('six-site verified twenty-day pair windows use twenty-day cash and exact previous period; no daily gifts are invented',async()=>{
 const policy=await loadCoinConversionPolicy(),pairs=[],cash={};for(const key of Object.keys(CONFIRMED_MERCHANTS)){pairs.push(pair(key,'2026-09','2026-09-20',policy).parsed,pair(key,'2026-10','2026-10-20',policy).parsed);cash[key]=[...parse(source(key,'2026-09-01','2026-09-20')).rows,...parse(source(key)).rows];}
 const funding=mergeMerchantFundingWindows(pairs,[],cash,policy),oct=funding.filter(r=>r.month==='2026-10');assert.equal(oct.length,6);for(const f of oct){assert.equal(f.through,'2026-10-20');assert.equal(f.prevThrough,'2026-09-20');assert.equal(f.directCash,200);assert.equal(f.prevDirectCash,200);assert.ok(Math.abs(f.buyAmount-100)<1e-8);assert.ok(Math.abs(f.sellAmount-60)<1e-8);assert.ok(Math.abs(f.revenueAmount-240)<1e-8);assert.equal(f.previousMerchantCovered,true);assert.equal(f.kind,'monthly_pair_ranking');assert.equal(f.queryProof.verified,true);}
 const old=pair('win','2026-10','2026-10-19',policy).parsed,oldCash={win:parse(source('win','2026-10-01','2026-10-19')).rows},fallback=mergeMerchantFundingWindows([old,pair('win','2026-10','2026-10-20',policy).parsed],[],oldCash,policy);assert.equal(fallback[0].through,'2026-10-19');assert.equal(fallback[0].directCash,190);
});

test('same-day unclosed pair or selected-date conflict cannot promote nineteen-day funding to twenty',async()=>{
 const policy=await loadCoinConversionPolicy();for(const edit of [s=>s.capturedAt='2026-10-20T02:00Z',s=>s.currentDayPartial=true,s=>s.queryProof.selectedThrough='2026-10-19']){const {raw}=pair('win','2026-10','2026-10-20',policy);edit(raw);const p=parseMerchantPairSnapshot(raw,'gift-rank-win-2026-10-01_2026-10-20.json');assert.equal(p.complete,false);assert.equal(p.buyCoins,null);}
});
