'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {validatePublicSnapshot}=require('./server');
function payload(){
  return {version:1,source:'local-whitelisted-b2b',lastUpdated:new Date().toISOString(),
    eventEpoch:3,eventPhase:'CCB',eventStartTW:'',eventEndTW:'',
    rankings:{SET2:{BET:[],MULT:[]},THOR:{BET:[],MULT:[]}},
    rtp:{SET2:null,THOR:null},
    bankruptcy:{status:'ready',total:3,checked:3,count:2,percentage:66.67,rows:[
      {rank:1,ordinal:1,aidMasked:'******0081',nickname:'阿金',
       balance:0.2,setNet:-90,thorNet:80},
      {rank:2,ordinal:2,aidMasked:'******0183',nickname:'雷雷',
       balance:0,setNet:10,thorNet:-230}
    ]}};
}
test('Bankrupt rate and signed profits are accepted only when all member wallets were checked',()=>{
 const p=validatePublicSnapshot(payload());
 assert.equal(p.bankruptcy.status,'ready');
 assert.deepEqual([p.bankruptcy.count,p.bankruptcy.total,p.bankruptcy.percentage],[2,3,66.67]);
 assert.equal(p.bankruptcy.rows[0].setNet,-90);
 assert.equal(p.bankruptcy.rows[0].thorNet,80);
 assert.equal(JSON.stringify(p).includes('1000000081'),false);
});
test('Unmasked AID and any private member fields are rejected',()=>{
 const x=payload();
 x.bankruptcy.rows[0].aidMasked='1000000081';
 assert.throws(()=>validatePublicSnapshot(x),/invalid_bankruptcy_player/);
 const y=payload();
 y.bankruptcy.rows[0].aid='1000000081';
 assert.throws(()=>validatePublicSnapshot(y),/invalid_bankruptcy_player/);
 const z=payload();
 z.bankruptcy.rows[0].name='real name';
 assert.throws(()=>validatePublicSnapshot(z),/invalid_bankruptcy_player/);
});
test('Do not accept guessed bankruptcy totals, out-of-order ordinals or above-threshold players',()=>{
 const x=payload();
 x.bankruptcy.percentage=99;
 assert.throws(()=>validatePublicSnapshot(x),/invalid_bankruptcy_totals/);
 const y=payload();
 y.bankruptcy.rows[0].balance=1;
 assert.throws(()=>validatePublicSnapshot(y),/invalid_bankruptcy_player/);
 const z=payload();
 z.bankruptcy.rows[1].ordinal=1;
 assert.throws(()=>validatePublicSnapshot(z),/invalid_bankruptcy_player/);
});
test('Verified balance below 1 stays eligible and exactly 1 is rejected',()=>{
 const x=payload();
 x.bankruptcy.rows[0].balance=0.99999;
 const out=validatePublicSnapshot(x);
 assert.equal(out.bankruptcy.count,2);
 assert.equal(out.bankruptcy.rows[0].balance,0.99999);
 x.bankruptcy.rows[0].balance=1;
 assert.throws(()=>validatePublicSnapshot(x),/invalid_bankruptcy_player/);
});
test('Unavailable wallet field must be explicitly unknown rather than zero count',()=>{
 const x=payload();
 x.bankruptcy={status:'unavailable',total:3,checked:0,count:null,percentage:null,rows:[]};
 assert.equal(validatePublicSnapshot(x).bankruptcy.count,null);
 x.bankruptcy.count=0;
 assert.throws(()=>validatePublicSnapshot(x),/invalid_bankruptcy_unavailable/);
});
test('Older local sync snapshot is still accepted without fake bankruptcy values',()=>{
 const x=payload();
 delete x.bankruptcy;
 assert.equal(validatePublicSnapshot(x).bankruptcy,null);
});
