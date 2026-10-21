// LEGACY_RATE_FIXTURE: injected 133/144 or alternate divisors test historical/custom DTO compatibility; current production rates come only from merchant-rates.json.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {parseMerchantPairSnapshot,mergeMerchantFundingWindows,buildMerchantFunding,loadCoinConversionPolicy} from './coin-conversion.mjs';

const policy={schema:1,method:'coins/divisor',rates:{qz:{buyDivisor:133,sellDivisor:144},song:{buyDivisor:133,sellDivisor:144},win:{buyDivisor:1.2,sellDivisor:1.22}}};
const header=['名次','贈禮AID','贈禮暱稱','對象AID','對象暱稱','贈禮總金額','差額'];
const merchant='90000000011',otherMerchant='90000000041';
const rows=[['1',merchant,'Merchant','player','Player','13300','6100'],['2','player','Player',merchant,'Merchant','7200','-6100'],['3',merchant,'Merchant',otherMerchant,'Other merchant','1000','1000'],['4','player','Player','friend','Friend','500','500']];
function snapshot(from='2000-10-01',through='2000-10-19',extra={}){return{platform:'qz',from,through,capturedAt:'2000-10-20T01:00:00Z',sourceUrl:'https://admin.qzplays.com:9955/statements/giving',tab:'贈禮排行',header,rows,totalRows:rows.length,complete:true,...extra};}
const parse=d=>parseMerchantPairSnapshot(d,`gift-rank-${d.platform}-${d.from}_${d.through}.json`);
function daily(from,to,cash=10){const rows=[];for(let t=Date.parse(from);t<=Date.parse(to);t+=86400000)rows.push([new Date(t).toISOString().slice(0,10),1,1,1,cash,null,null,null,0,0]);return rows;}

test('monthly pair uses directed give exactly once, excludes merchant transfers and never sums delta',()=>{
 const data=snapshot();data.rows=[...rows,rows[0]];data.totalRows=data.rows.length;const p=parse(data);
 assert.equal(p.complete,true);assert.equal(p.buyCoins,13300);assert.equal(p.sellCoins,7200);assert.equal(p.validation.duplicatePairs,1);assert.equal(p.validation.excludedMerchantPairs,1);assert.equal(p.validation.excludedOrdinaryPairs,1);assert.equal(p.validation.netChecks.mismatched,0);assert.deepEqual(p.merchantIDs,[merchant,otherMerchant]);
});
test('incomplete, forged source, invalid month range and inconsistent directed data cannot produce month values',()=>{
 for(const change of [d=>d.complete=false,d=>d.sourceUrl='https://example.invalid/statements/giving',d=>d.sourceUrl='https://admin.song-yy.com:9955/statements/giving',d=>d.from='2000-10-14',d=>d.through='2000-10-31',d=>d.totalRows=99,d=>d.tab='other',d=>d.capturedAt=null,d=>d.rows=[['1',merchant,'M','p','P','','0']],d=>d.rows=[rows[0],[...rows[0].slice(0,5),'999','999']],d=>d.rows=[rows[0]]]){
  const d=snapshot();change(d);const p=parse(d);assert.equal(p.complete,false);assert.equal(p.buyCoins,null);assert.equal(p.sellCoins,null);assert.equal(mergeMerchantFundingWindows([p],[],{qz:daily('2000-10-01','2000-10-19')},policy).length,0);
 }
 const d=snapshot();const p=parseMerchantPairSnapshot(d,'gift-rank-song-2000-10-01_2000-10-19.json');assert.equal(p.complete,false);
});
test('Oct 1–19 uses Sep 1–19 only, even when full September is available; 133/144 rates remain unrounded',()=>{
 const oct=parse(snapshot()),sepFull=parse(snapshot('2000-09-01','2000-09-30')),cash={qz:daily('2000-08-01','2000-10-19')};
 let output=mergeMerchantFundingWindows([oct,sepFull],[],cash,policy),o=output.find(m=>m.month==='2000-10');assert.equal(o.prevThrough,'2000-09-19');assert.equal(o.prevBuyCoins,null);assert.equal(o.previousMerchantCovered,false);assert.equal(o.buyAmount,100);assert.equal(o.sellAmount,50);assert.equal(o.revenueAmount,240);
 const sep19=parse(snapshot('2000-09-01','2000-09-19'));output=mergeMerchantFundingWindows([oct,sepFull,sep19],[],cash,policy);o=output.find(m=>m.month==='2000-10');assert.equal(o.previousMerchantCovered,true);assert.equal(o.prevBuyCoins,13300);assert.equal(o.prevBuyAmount,100);assert.equal(o.prevRevenueAmount,240);assert.equal(output.filter(m=>m.month==='2000-09').length,1);assert.equal(output.find(m=>m.month==='2000-09').through,'2000-09-30');
});
test('complete September compares with full August, preserving original 31-day cash range',()=>{
 const sep=parse(snapshot('2000-09-01','2000-09-30')),aug=parse(snapshot('2000-08-01','2000-08-31')),cash={qz:daily('2000-08-01','2000-09-30')},s=mergeMerchantFundingWindows([sep,aug],[],cash,policy).find(m=>m.month==='2000-09');assert.equal(s.prevThrough,'2000-08-31');assert.equal(s.prevDirectCash,310);assert.equal(s.directCash,300);assert.equal(s.partial,false);assert.equal(s.previousMerchantCovered,true);
});
test('missing official daily cash remains null and complete zero pair reports remain real zero',()=>{
 const p=parse(snapshot('2000-10-01','2000-10-19',{rows:[],totalRows:0}));assert.equal(p.buyCoins,0);assert.equal(p.sellCoins,0);
 const [missing]=mergeMerchantFundingWindows([p],[],{},policy);assert.equal(missing.covered,true);assert.equal(missing.directCash,null);assert.equal(missing.revenueAmount,null);
 const [zero]=mergeMerchantFundingWindows([p],[],{qz:daily('2000-10-01','2000-10-19',0)},policy);assert.equal(zero.revenueAmount,0);
});
test('pair-only ingestion creates monthly coverage but no fabricated daily transfers',async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'pair-funding-')),file='gift-rank-qz-2000-10-01_2000-10-19.json';try{
  await fs.writeFile(path.join(dir,file),JSON.stringify(snapshot()));const result=await buildMerchantFunding(dir,{qz:daily('2000-10-01','2000-10-19')},policy);assert.deepEqual(result.fundingDaily,[]);assert.equal(result.funding.length,1);assert.equal(result.funding[0].buyAmount,100);assert.equal(result.merchantCoverage[0].sourceReport,'贈禮排行');
 }finally{await fs.unlink(path.join(dir,file)).catch(e=>{if(e.code!=='ENOENT')throw e;});await fs.rmdir(dir);}
});
test('actual validated Win transaction source still wins a conflicting pair snapshot for its exact period',async()=>{
 const live='C:/Users/User/Documents/ChatGPT/outputs/01a15831-ccf2-7fc3-bbe2-813c2cd1dc71/live-data',raw=JSON.parse(await fs.readFile(path.join(live,'backend-history-win.json'),'utf8')),realPolicy=await loadCoinConversionPolicy(),base=await buildMerchantFunding(live,{win:raw.daily},realPolicy),pair={platform:'win',from:'2026-10-01',through:'2026-10-19',complete:true,covered:true,buyCoins:1,sellCoins:2,capturedAt:'2026-10-20T01:00:00Z'},out=mergeMerchantFundingWindows([pair],base.fundingDaily,{win:raw.daily},realPolicy,base.merchantCoverage[0]),oct=out.find(r=>r.platform==='win'&&r.month==='2026-10');
 assert.equal(base.fundingDaily.length,49);assert.equal(oct.kind,'validated_transactions');assert.equal(oct.buyCoins,1752756);assert.equal(oct.sellCoins,2022394);assert.equal(oct.prevBuyCoins,1776650);assert.equal(oct.revenueAmount,505130);assert.equal(base.fundingDaily.reduce((n,r)=>n+r.buyCoins,0),4014950);
});
