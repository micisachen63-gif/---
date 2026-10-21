import test from 'node:test';
import assert from 'node:assert/strict';
import {loadCoinConversionPolicy,convertCoins,addFundingConversion,validateCoinConversionPolicy,CONVERSION_DEFINITION,REVENUE_DEFINITION,revenueAmount,buildFundingDaily,buildMerchantFunding,parseMerchantSnapshot} from './coin-conversion.mjs';
import fs from 'node:fs/promises';

test('使用者指定十二站除數與未知生效日原樣保留',async()=>{
 const policy=await loadCoinConversionPolicy();assert.equal(policy.effectiveFrom,null);assert.equal(policy.source,'使用者明確確認');assert.equal(policy.method,'coins/divisor');assert.equal(policy.confirmedOnTaipei,'2026-10-21');assert.deepEqual([...policy.confirmationScope].sort(),['song','qz','bo','o8','goldfun','o9','cgb'].sort());
 for(const p of ['win','lucky']){assert.equal(policy.rates[p].buyDivisor,1.2);assert.equal(policy.rates[p].sellDivisor,1.22);assert.ok(policy.rates[p].name);}
 for(const p of ['rd','fcc','aos']){assert.equal(policy.rates[p].buyDivisor,1.1);assert.equal(policy.rates[p].sellDivisor,1.11);assert.ok(policy.rates[p].name);}
 for(const p of ['qz','song','bo','o8','goldfun','o9']){assert.equal(policy.rates[p].buyDivisor,130);assert.equal(policy.rates[p].sellDivisor,144);assert.equal(convertCoins(13000,p,'buy',policy),100);assert.equal(convertCoins(14400,p,'sell',policy),100);}
 assert.equal(policy.rates.cgb.buyDivisor,130);assert.equal(policy.rates.cgb.sellDivisor,135);assert.equal(convertCoins(13000,'cgb','buy',policy),100);assert.equal(convertCoins(13500,'cgb','sell',policy),100);
 assert.equal(Object.keys(policy.rates).length,12);assert.equal(policy.rates.unconfigured,undefined);
 for(const key of ['goldfun','o9']){assert.equal(policy.rates[key].buyDivisor,130);assert.equal(policy.rates[key].sellDivisor,144);assert.equal(convertCoins(13000,key,'buy',policy),100);assert.equal(convertCoins(14400,key,'sell',policy),100);}
 assert.match(CONVERSION_DEFINITION,/估算/);assert.match(CONVERSION_DEFINITION,/不適用官儲/);
});
test('Win換算方向正確、不提前round、同時保留原始coin與官儲',async()=>{
 const policy=await loadCoinConversionPolicy();const row=Object.freeze({platform:'win',buyCoins:1752756,sellCoins:2022394,prevBuyCoins:1776650,prevSellCoins:2244800,directCash:702200});
 const [result]=addFundingConversion([row],policy);
 assert.equal(result.buyAmount,1460630);
 assert.ok(Math.abs(result.sellAmount-1657700)<1e-8);
 assert.equal(result.prevBuyAmount,1776650/1.2);assert.notEqual(result.prevBuyAmount,Math.round(result.prevBuyAmount));
 assert.equal(result.prevSellAmount,2244800/1.22);
 assert.equal(result.directCash,702200);assert.equal(result.buyCoins,1752756);assert.equal(result.sellCoins,2022394);assert.equal(Object.hasOwn(row,'buyAmount'),false);
});
test('null與0分開；未知站不能沿用別站除數',async()=>{
 const p=await loadCoinConversionPolicy();
 for(const v of [null,undefined,'',NaN,Infinity,-1,'0'])assert.equal(convertCoins(v,'win','buy',p),null);
 assert.equal(convertCoins(0,'win','buy',p),0);assert.equal(convertCoins(0,'win','sell',p),0);
 assert.equal(convertCoins(0,'unconfigured','buy',p),null);assert.equal(convertCoins(1100,'unconfigured','buy',p),null);
 assert.equal(convertCoins(1100,'rd','buy',p),1100/1.1);assert.equal(convertCoins(1110,'fcc','sell',p),1110/1.11);
 assert.equal(convertCoins(100,'win','deposit',p),null);
});
test('設定無效除數拒絕，不靜默產生錯誤精準金額',()=>{
 for(const divisor of [0,-1,null,'1.2',Infinity])assert.throws(()=>validateCoinConversionPolicy({schema:1,method:'coins/divisor',rates:{win:{buyDivisor:divisor,sellDivisor:1.22}}}),/除數無效/);
 assert.throws(()=>validateCoinConversionPolicy({schema:1,method:'coins*rate',rates:{}}),/格式不符/);
});
test('只有已驗證覆蓋內才補0，未知日期及官儲不補0',async()=>{
 const policy=await loadCoinConversionPolicy(),coverage={platform:'win',from:'2026-09-01',to:'2026-09-02',complete:true};
 const rows=buildFundingDaily([{date:'2026-09-01',direction:'buy',coins:120}],coverage,[],policy);
 assert.equal(rows.length,2);assert.equal(rows[0].buyAmount,100);assert.equal(rows[1].buyCoins,0);assert.equal(rows[1].buyAmount,0);assert.equal(rows[1].directCash,null);assert.equal(rows.find(r=>r.date==='2026-08-31'),undefined);
 assert.throws(()=>buildFundingDaily([],{...coverage,complete:false},[],policy),/不可補0/);
});
test('原始欄位按名稱解析、僅成功時間歸日且買賣方向不可顛倒',()=>{
 const snapshot={rows:[['贈禮狀態','對象AID','贈禮金額','交易完成時間','贈禮AID','贈禮時間'],['成功','99','120','2026-10-01 00:01:00','90000000002','2026-09-30 23:59:00']]};
 assert.equal(parseMerchantSnapshot(snapshot,'buy')[0].date,'2026-10-01');assert.throws(()=>parseMerchantSnapshot(snapshot,'sell'),/方向/);
});
test('實際完整49天每日加總與月彙總吻合既有後台金額',async()=>{
 const live='C:/Users/User/Documents/ChatGPT/outputs/01a15831-ccf2-7fc3-bbe2-813c2cd1dc71/live-data';
 const raw=JSON.parse(await fs.readFile(live+'/backend-history-win.json','utf8')),policy=await loadCoinConversionPolicy();
 const result=await buildMerchantFunding(live,{win:raw.daily},policy),oct=result.funding.find(r=>r.month==='2026-10'),sep=result.funding.find(r=>r.month==='2026-09');
 assert.equal(result.fundingDaily.length,49);assert.equal(result.merchantCoverage[0].from,'2026-09-01');assert.equal(result.merchantCoverage[0].to,'2026-10-19');
 assert.equal(oct.buyCoins,1752756);assert.equal(oct.sellCoins,2022394);assert.equal(oct.prevBuyCoins,1776650);assert.equal(oct.prevSellCoins,2244800);assert.equal(oct.directCash,702200);assert.equal(oct.prevDirectCash,1087000);
 for(const m of [sep,oct]){assert.equal(m.from,m.month+'-01');assert.equal(m.to,m.through);assert.equal(m.covered,true);}
 assert.equal(oct.buyAmount,1460630);assert.ok(Math.abs(oct.sellAmount-1657700)<1e-8);assert.equal(sep.prevBuyCoins,1776994);assert.equal(sep.prevBuyAmount,1776994/1.2);assert.equal(sep.prevSellCoins,3244468);assert.equal(sep.prevFrom,'2026-08-01');assert.equal(sep.prevThrough,'2026-08-31');
 assert.ok(Math.abs(oct.revenueAmount-505130)<1e-8);assert.ok(Math.abs(oct.prevRevenueAmount-(1087000+1776650/1.2-2244800/1.22))<1e-8);assert.equal(sep.prevRevenueAmount,result.funding.find(r=>r.platform==='win'&&r.month==='2026-08').revenueAmount);
 for(const month of [sep,oct]){const rows=result.fundingDaily.filter(r=>r.date.startsWith(month.month));assert.equal(rows.reduce((s,r)=>s+r.buyCoins,0),month.buyCoins);assert.equal(rows.reduce((s,r)=>s+r.sellCoins,0),month.sellCoins);assert.ok(Math.abs(rows.reduce((s,r)=>s+r.buyAmount,0)-month.buyAmount)<1e-8);assert.ok(Math.abs(rows.reduce((s,r)=>s+r.revenueAmount,0)-month.revenueAmount)<1e-8);}
 assert.equal(result.fundingDaily.reduce((s,r)=>s+r.buyCoins,0),4014950);assert.equal(result.fundingDaily.reduce((s,r)=>s+r.sellCoins,0),4730916);
});
test('營收公式須三項全部已知；真0與負營收可保留',async()=>{
 const p=await loadCoinConversionPolicy();assert.equal(p.revenueFormula,'directCash + buyAmount - sellAmount');assert.match(REVENUE_DEFINITION,/使用者指定營收口徑/);assert.match(REVENUE_DEFINITION,/非扣除活動及營運成本後淨利/);
 assert.equal(revenueAmount(0,0,0,'win',p),0);assert.equal(revenueAmount(0,0,122,'win',p),-100);assert.equal(revenueAmount(100,13000,14400,'song',p),100);
 for(const values of [[null,0,0],[0,null,0],[0,0,null],[-1,0,0],[0,NaN,0],[Infinity,0,0]])assert.equal(revenueAmount(...values,'win',p),null);
 assert.equal(revenueAmount(0,0,0,'unconfigured',p),null);
 const [missingCoverage]=addFundingConversion([{platform:'win',directCash:0,buyCoins:0,sellCoins:0,covered:false}],p);assert.equal(missingCoverage.revenueAmount,null);
});
