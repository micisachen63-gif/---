import test from 'node:test';
import assert from 'node:assert/strict';
import {screenMerchantEvidence as screen} from './merchant-screening.mjs';
const gift=(counterparties,extra={})=>({platform:'fixture',aid:'fixture-a',verified:true,from:'2026-10-01',through:'2026-10-20',counterparties,...extra});
const base=(extra={})=>({platform:'fixture',aid:'fixture-a',lifetimeCash:300,currentGift:gift(8),monthlyEvidence:[],expectedFrom:'2026-10-01',expectedThrough:'2026-10-20',...extra});
test('cash boundaries distinguish strictly under 1000 and strictly over 10000',()=>{
 assert.equal(screen(base({lifetimeCash:999})).category,'retained_low_cash');
 for(const n of [1000,10000])assert.equal(screen(base({lifetimeCash:n})).category,'review_middle_cash');
 assert.equal(screen(base({lifetimeCash:10001})).category,'excluded_high_cash');
});
test('twenty different counterparties retains a high-cash account; nineteen does not',()=>{
 assert.equal(screen(base({lifetimeCash:100000,currentGift:gift(20)})).category,'retained_current_breadth');
 assert.equal(screen(base({lifetimeCash:100000,currentGift:gift(19)})).category,'excluded_high_cash');
});
test('a known streamer role overrides low cash and breadth; unknown roles do not',()=>{
 assert.equal(screen(base({currentGift:gift(50),knownRole:{kind:'streamer',confirmed:true}})).category,'excluded_known_streamer');
 assert.equal(screen(base({currentGift:gift(50),knownRole:{kind:'streamer',confirmed:false}})).category,'retained_current_breadth');
});
test('historical breadth is retained independently of fewer current counterparties',()=>{
 const result=screen(base({lifetimeCash:60000,currentGift:gift(13),monthlyEvidence:[gift(37,{from:'2026-05-01',through:'2026-05-31'})]}));
 assert.equal(result.category,'retained_historical_breadth');assert.deepEqual(result.historicalTwentyMonths,['2026-05']);
});
test('a seven-day window can prove twenty but cannot prove a monthly exception absent',()=>{
 const weekly=gift(11,{from:'2026-10-14'});
 assert.equal(screen(base({lifetimeCash:60000,currentGift:weekly})).category,'review_incomplete_month');
 assert.equal(screen(base({lifetimeCash:60000,currentGift:{...weekly,counterparties:20}})).category,'retained_current_breadth');
});
test('unknown lifetime cash never becomes zero or a monthly cash substitute',()=>{
 for(const n of [null,undefined,'300',NaN,-1]){const result=screen(base({lifetimeCash:n}));assert.equal(result.category,'review_missing_lifetime');assert.equal(result.lifetimeCash,null);}
});
test('one or two counterparties at low cash remain a settlement or role review',()=>{
 for(const n of [0,1,2])assert.equal(screen(base({currentGift:gift(n)})).category,'review_narrow_low_cash');
});
test('unverified, cross-platform, different-AID and cross-month evidence cannot establish breadth',()=>{
 for(const e of [gift(50,{verified:false}),gift(50,{platform:'another'}),gift(50,{aid:'another'}),gift(50,{from:'2026-09-01'})])assert.equal(screen(base({lifetimeCash:50000,currentGift:e,monthlyEvidence:[e]})).category,'review_incomplete_month');
});
test('screening cannot assert only one deposit, confirmed identity, or actual revenue eligibility',()=>{
 const result=screen(base({currentGift:gift(30)}));assert.equal(result.identityConfirmed,false);assert.equal(result.includeInActualRevenue,false);assert.equal(result.firstDepositCount,null);assert.equal(result.firstDepositOnlyVerified,false);
 assert.equal(screen(base({userConfirmed:true})).category,'confirmed_by_user');
});
