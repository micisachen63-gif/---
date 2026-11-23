'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {validatePublicSnapshot}=require('./server');
function fixture(){
 return {version:1,source:'local-whitelisted-b2b',lastUpdated:new Date().toISOString(),
  eventEpoch:3,eventPhase:'CCB',eventStartTW:'',eventEndTW:'',
  rankings:{SET2:{BET:[],MULT:[]},THOR:{BET:[],MULT:[]}},
  rtp:{SET2:null,THOR:null},
  bankruptcy:{status:'ready',total:3,checked:3,count:1,percentage:33.33,rows:[
   {rank:1,ordinal:1,aidMasked:'******0183',nickname:'雷雷',balance:0.2,setNet:0,thorNet:-230}
  ]},
  wealth:{status:'ready',total:3,checked:3,rows:[
   {rank:1,aidMasked:'******0081',nickname:'富翁',balance:950000.25,setNet:1200,thorNet:0},
   {rank:2,aidMasked:'******0184',nickname:'幸運',balance:3000,setNet:0,thorNet:5},
   {rank:3,aidMasked:'******0183',nickname:'雷雷',balance:0.2,setNet:0,thorNet:-230}
  ]}
 };
}
test('Wealth ranking validates all registered current wallets and omits private identity',()=>{
 const normalized=validatePublicSnapshot(fixture());
 assert.equal(normalized.wealth.status,'ready');
 assert.equal(normalized.wealth.total,3);
 assert.equal(normalized.wealth.rows[0].balance,950000.25);
 assert.equal(normalized.wealth.rows[2].aidMasked,'******0183');
 assert.equal(JSON.stringify(normalized).includes('1000000081'),false);
 assert.equal(JSON.stringify(normalized).includes('awardLedger'),false);
});
test('Reject unmasked AID, unknown private account fields and forged order',()=>{
 for(const change of [
  x=>x.wealth.rows[0].aidMasked='1000000081',
  x=>x.wealth.rows[0].realName='private',
  x=>x.wealth.rows[1].balance=950001,
  x=>x.wealth.rows[2].rank=10,
  x=>x.wealth.rows.pop()
 ]){
  const x=fixture();change(x);
  assert.throws(()=>validatePublicSnapshot(x),/invalid_wealth_(player|totals)/);
 }
});
test('Wallet count and bankruptcy thresholds must match same B2B retrieval',()=>{
 const x=fixture();x.wealth.rows[2].balance=0.21;
 assert.throws(()=>validatePublicSnapshot(x),/wealth_bankruptcy_count_mismatch/);
 const y=fixture();y.wealth.rows[2].nickname='陌生人';
 assert.throws(()=>validatePublicSnapshot(y),/wealth_bankruptcy_player_mismatch/);
 const z=fixture();z.wealth.total=4;
 assert.throws(()=>validatePublicSnapshot(z),/invalid_wealth_totals/);
});
test('Wallet outage is explicit, not a fictitious zero-wallet ranking',()=>{
 const p=fixture();p.wealth={status:'unavailable',total:3,checked:0,rows:[]};
 p.bankruptcy={status:'unavailable',total:3,checked:0,count:null,percentage:null,rows:[]};
 assert.equal(validatePublicSnapshot(p).wealth.status,'unavailable');
 p.wealth.rows.push({rank:1,aidMasked:'******0183',nickname:'誰',balance:0,setNet:0,thorNet:0});
 assert.throws(()=>validatePublicSnapshot(p),/invalid_wealth_unavailable/);
});
test('Legacy snapshots can omit wealth until updated local worker is restarted',()=>{
 const p=fixture();delete p.wealth;
 assert.equal(validatePublicSnapshot(p).wealth,null);
});
