'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {validatePublicSnapshot,validatePrivateAwardLedger}=require('./server');
function fixture(){
 const data={version:1,source:'local-whitelisted-b2b',lastUpdated:new Date().toISOString(),
  eventEpoch:9,eventPhase:'CCB',eventStartTW:'',eventEndTW:'',
  rankings:{SET2:{
    BET:[{rank:1,nickname:'同名玩家',score:680000}],
    MULT:[{rank:1,nickname:'同名玩家',score:1000}]},
    THOR:{BET:[{rank:1,nickname:'另一個',score:280000}],MULT:[]}},
  rtp:{SET2:90,THOR:92},
  luckboard:{ALL:[
   {rank:1,nickname:'同名玩家',spins:1000,bet:680000,rtp:100},
   {rank:2,nickname:'另一個',spins:200,bet:280000,rtp:90}
  ],SET2:[
   {rank:1,nickname:'同名玩家',spins:1000,bet:680000,rtp:100},
   {rank:null,nickname:'尚無遊戲紀錄',spins:0,bet:0,rtp:null}
  ],THOR:[
   {rank:1,nickname:'另一個',spins:200,bet:280000,rtp:90},
   {rank:null,nickname:'尚無遊戲紀錄',spins:0,bet:0,rtp:null}
  ]}
 };
 const ledger={eventEpoch:9,machineRows:{
  SET2:{BET:[{aid:'1000000081',rank:1,nickname:'同名玩家',score:680000}],
    MULT:[{aid:'1000000081',rank:1,nickname:'同名玩家',score:1000}],
    ACH:[{aid:'1000000081',nickname:'同名玩家',bet:680000}]},
  THOR:{BET:[{aid:'1000000183',rank:1,nickname:'另一個',score:280000}],
    MULT:[],ACH:[{aid:'1000000183',nickname:'另一個',bet:280000}]}
 }};
 return {data,ledger};
}
test('Admin AID ledger matches both public ranking categories and full achievement details',()=>{
 const {data,ledger}=fixture(),pub=validatePublicSnapshot(data);
 const checked=validatePrivateAwardLedger(ledger,pub);
 assert.equal(checked.eventEpoch,9);
 assert.equal(checked.lastUpdated,pub.lastUpdated);
 assert.equal(checked.machineRows.SET2.ACH[0].bet,680000);
 assert.equal(checked.machineRows.THOR.BET[0].aid,'1000000183');
 assert.equal(JSON.stringify(pub).includes('1000000081'),false);
 assert.equal(JSON.stringify(pub).includes('1000000183'),false);
 assert.equal(JSON.stringify(pub).includes('awardLedger'),false);
});
test('Mismatched AID totals/nicknames/ranks and unsigned extra payload fields are rejected',()=>{
 const {data,ledger}=fixture(),pub=validatePublicSnapshot(data);
 const mutate=(change,pattern)=>{
  const x=structuredClone(ledger);change(x);
  assert.throws(()=>validatePrivateAwardLedger(x,pub),pattern);
 };
 mutate(x=>x.machineRows.SET2.BET[0].score=1,/award_ledger_ranking_mismatch/);
 mutate(x=>x.machineRows.SET2.BET[0].nickname='他人',/award_ledger_ranking_mismatch/);
 mutate(x=>x.machineRows.SET2.ACH[0].bet=80000,/award_ledger_achievement_mismatch/);
 mutate(x=>x.machineRows.THOR.BET=[],/award_ledger_ranking_incomplete/);
 mutate(x=>x.machineRows.SET2.BET[0].name='private name',/award_ledger_player_invalid/);
 mutate(x=>x.machineRows.SET2.BET[0].aid='=HYPERLINK("https://evil.invalid")',/award_ledger_player_invalid/);
 mutate(x=>x.eventEpoch=8,/award_ledger_invalid/);
});
