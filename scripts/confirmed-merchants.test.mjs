// LEGACY_RATE_FIXTURE: injected 133/144 divisors below test historical compatibility; the separate real-source test loads the current merchant-rates.json policy.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {MERCHANT_IDENTITY_REGISTRY,CONFIRMED_MERCHANTS,merchantConfirmation} from './merchant-identities.mjs';
import {parseMerchantPairSnapshot,parseMerchantParticipantSnapshot,mergeMerchantFundingWindows,buildMerchantFunding,loadCoinConversionPolicy} from './coin-conversion.mjs';
import {analyzeGiftReports} from './merchant-candidates.mjs';
import {makeCohorts} from './cohort-data.mjs';

const policy={schema:1,method:'coins/divisor',rates:{win:{buyDivisor:1.2,sellDivisor:1.22},qz:{buyDivisor:133,sellDivisor:144},song:{buyDivisor:133,sellDivisor:144},rd:{buyDivisor:1.1,sellDivisor:1.11},lucky:{buyDivisor:1.2,sellDivisor:1.22},bo:{buyDivisor:133,sellDivisor:144}}};
const header=['名次','贈禮AID','贈禮暱稱','對象AID','對象暱稱','贈禮總金額','差額'];
function snapshot(platform,from='2000-10-01',through='2000-10-19',extra={}){const identity=MERCHANT_IDENTITY_REGISTRY.platforms[platform],a=identity.accounts[0],b=identity.accounts[1];return{platform,from,through,capturedAt:'2000-10-20T01:00:00Z',sourceUrl:'https://'+identity.host+'/statements/giving',tab:'贈禮排行',complete:true,header,rows:[['1',a.aid,a.nickname,'member','Member','13300','6100'],['2','member','Member',a.aid,a.nickname,'7200','-6100'],['3',a.aid,a.nickname,b.aid,b.nickname,'100','100']],totalRows:3,...extra};}
const filename=s=>`gift-rank-${s.platform}-${s.from}_${s.through}.json`;
const rank=(month,through,cash)=>({platform:'rd',complete:true,period:{from:month+'-01',to:through},header:['名次','AID','暱稱','儲值金額'],rows:cash===null?[]:[['1','member','Member',cash]]});
function daily(from,through){const out=[];for(let t=Date.parse(from);t<=Date.parse(through);t+=86400000)out.push([new Date(t).toISOString().slice(0,10),1,1,1,10,null,null,null,0,0]);return out;}

test('one immutable six-site identity authority retains explicit user confirmation date and eight new accounts',()=>{
 assert.deepEqual(Object.keys(CONFIRMED_MERCHANTS),['win','qz','song','rd','lucky','bo']);assert.deepEqual(CONFIRMED_MERCHANTS.rd,['90000000027','90000000028','90000000029']);assert.deepEqual(CONFIRMED_MERCHANTS.lucky,['90000000030','90000000031']);assert.deepEqual(CONFIRMED_MERCHANTS.bo,['90000000032','90000000033','90000000034']);
 for(const p of Object.keys(CONFIRMED_MERCHANTS)){const c=merchantConfirmation(p);assert.equal(c.merchantIdentityStatus,'confirmed_by_user');assert.equal(c.merchantIdentityConfirmedOnTaipei,'2026-10-20');assert.equal(c.merchantIdentityTimezone,'Asia/Taipei');assert.equal(c.merchantIdentityConfirmedAt,null);assert.ok(c.merchantIdentitySource.includes('使用者'));}
 assert.throws(()=>CONFIRMED_MERCHANTS.rd.push('unapproved'),TypeError);assert.equal(CONFIRMED_MERCHANTS.o8,undefined);
});
test('new three sites share directed-give rules, exclude internal transfers, and retain null versus real zero',()=>{
 for(const platform of ['rd','lucky','bo']){const s=snapshot(platform),p=parseMerchantPairSnapshot(s,filename(s));assert.equal(p.complete,true);assert.equal(p.buyCoins,13300);assert.equal(p.sellCoins,7200);assert.equal(p.validation.excludedMerchantPairs,1);assert.equal(p.merchantIdentityConfirmedOnTaipei,'2026-10-20');const empty=snapshot(platform,undefined,undefined,{rows:[],totalRows:0}),zero=parseMerchantPairSnapshot(empty,filename(empty));assert.equal(zero.buyCoins,0);const bad={...s,complete:false};assert.equal(parseMerchantPairSnapshot(bad,filename(bad)).buyCoins,null);}
});
test('identity lookup is platform scoped and never promotes a known merchant ID from another site',()=>{
 const s=snapshot('bo',undefined,undefined,{rows:[['1',CONFIRMED_MERCHANTS.win[0],'Other site merchant','member','Member','100','100']],totalRows:1}),p=parseMerchantPairSnapshot(s,filename(s));assert.equal(p.complete,true);assert.equal(p.buyCoins,0);assert.equal(p.sellCoins,0);assert.equal(p.validation.excludedOrdinaryPairs,1);
});
test('confirmed accounts leave the unconfirmed candidate list while competitors cannot auto-upgrade',()=>{
 for(const platform of ['rd','lucky','bo']){const s=snapshot(platform),g=analyzeGiftReports([{file:filename(s),data:s}]).groups[0];assert.equal(g.confirmedMerchants.length,CONFIRMED_MERCHANTS[platform].length);for(const a of g.confirmedMerchants){assert.equal(a.verifiedMerchant,true);assert.equal(a.level,'confirmed');assert.equal(a.includeInRevenue,false);assert.equal(g.candidates.some(c=>c.aid===a.aid),false);assert.equal(a.identitySource,'使用者明確確認');assert.equal(a.confirmedAt,'2026-10-20');assert.equal(a.confirmationPrecision,'date');assert.equal(a.amountsComplete,true);assert.ok(a.sourceFiles.length>0);}}
 const s=snapshot('rd');s.platform='o8';const g=analyzeGiftReports([{file:'competitor.json',data:s}]).groups[0];assert.equal(g.confirmedMerchants.length,0);assert.ok(g.accounts.every(a=>a.verifiedMerchant===false));
});
test('confirmed identities absent from complete rows are explicit zero, but incomplete rows remain null',()=>{
 for(const complete of [true,false]){const s=snapshot('bo',undefined,undefined,{rows:[],totalRows:0,complete}),g=analyzeGiftReports([{file:filename(s),data:s}]).groups[0];assert.equal(g.accountCount,0);assert.equal(g.confirmedMerchants.length,3);for(const a of g.confirmedMerchants){assert.equal(a.in,complete?0:null);assert.equal(a.out,complete?0:null);assert.equal(a.amountsComplete,complete);assert.equal(a.capturedAt,s.capturedAt);assert.equal(a.sourceFiles[0],filename(s));assert.equal(a.confirmationTimestamp,null);}}
});
test('participant flows are range totals, deduplicated, and unavailable until the matching complete range exists',()=>{
 const prior=snapshot('rd','2000-09-01','2000-09-19'),current=snapshot('rd'),pw=parseMerchantParticipantSnapshot(prior,filename(prior)),cw=parseMerchantParticipantSnapshot(current,filename(current));
 assert.deepEqual(cw.participants.get('member'),{received:13300,returned:7200});assert.equal(cw.participants.size,1);assert.equal(Object.hasOwn(cw,'daily'),false);
 const rankings=[rank('2000-09','2000-09-30',100),rank('2000-10','2000-10-19',null)],c=makeCohorts(rankings,[],false,'rd',{merchantWindows:[pw,cw]})[0];
 assert.equal(c.previousMerchantCovered,false);assert.equal(c.currentMerchantCovered,true);assert.equal(c.merchantCovered,false);assert.equal(c.rows[0].prevCoins,null);assert.equal(c.rows[0].currentCoins,13300);assert.equal(c.rows[0].coinsDelta,null);assert.equal(c.rows[0].noRepurchase,false);
 const full=snapshot('rd','2000-09-01','2000-09-30'),fw=parseMerchantParticipantSnapshot(full,filename(full)),complete=makeCohorts(rankings,[],false,'rd',{merchantWindows:[fw,cw]})[0];assert.equal(complete.merchantCovered,true);assert.equal(complete.rows[0].prevCoins,13300);assert.equal(complete.rows[0].coinsDelta,0);
 const wrongSite=makeCohorts(rankings,[],false,'lucky',{merchantWindows:[fw,cw]})[0];assert.equal(wrongSite.currentMerchantCovered,false);assert.equal(wrongSite.rows[0].currentCoins,null);
});
test('six current windows use existing divisors without any balance, stock or target-sheet substitution',()=>{
 const windows=[],cash={};for(const platform of Object.keys(CONFIRMED_MERCHANTS)){const s=snapshot(platform),prior=snapshot(platform,'2000-09-01','2000-09-19');windows.push(parseMerchantPairSnapshot(s,filename(s)),parseMerchantPairSnapshot(prior,filename(prior)));cash[platform]=daily('2000-09-01','2000-10-19');}
 const funding=mergeMerchantFundingWindows(windows,[],cash,policy).filter(f=>f.month==='2000-10');assert.equal(funding.length,6);for(const row of funding){assert.equal(row.buyCoins,13300);assert.equal(row.sellCoins,7200);assert.equal(row.revenueAmount,190+13300/policy.rates[row.platform].buyDivisor-7200/policy.rates[row.platform].sellDivisor);assert.equal(row.prevThrough,'2000-09-19');assert.equal(row.previousMerchantCovered,true);assert.ok(row.merchantIDs.length>=2);}
});
test('read-only live integration yields all six October 19-day flows and preserves Win 49-day source',async()=>{
 const live='C:/Users/User/Documents/ChatGPT/outputs/01a15831-ccf2-7fc3-bbe2-813c2cd1dc71/live-data',cash={};for(const platform of Object.keys(CONFIRMED_MERCHANTS))cash[platform]=JSON.parse(await fs.readFile(path.join(live,'backend-history-'+platform+'.json'),'utf8')).daily;
 const result=await buildMerchantFunding(live,cash,await loadCoinConversionPolicy()),oct=result.funding.filter(f=>f.month==='2026-10');assert.equal(result.fundingDaily.length,49);assert.equal(oct.length,6);for(const row of oct){assert.equal(row.from,'2026-10-01');assert.equal(row.through,'2026-10-19');assert.equal(row.prevThrough,'2026-09-19');assert.equal(row.covered,true);assert.equal(row.previousMerchantCovered,true);assert.ok(Number.isFinite(row.revenueAmount));assert.equal(row.merchantIdentityConfirmedOnTaipei,'2026-10-20');}assert.equal(oct.find(f=>f.platform==='win').revenueAmount,505130);
});
