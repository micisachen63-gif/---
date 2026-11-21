'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {normalizeBetRows,cleanNickname,problems,validatePublicSnapshot,protectedTokenMatches}=require('./server');
test('No verified valid-bet field means no fabricated leaderboard',()=>{
 assert.throws(()=>normalizeBetRows([{aId:'123',bet:1000,nickname:'player'}],10),/official_valid_bet_field_unverified/);
});
test('Use exact effective-bet values, never total bet',()=>{
 const rows=normalizeBetRows([{nickname:'乙',bet:9999,validBet:200},{nickname:'甲',bet:1,validBet:250}],10);
 assert.deepEqual(rows,[{rank:1,nickname:'甲',score:250},{rank:2,nickname:'乙',score:200}]);
});
test('No AID, name or financial raw data exposed',()=>{
 const rows=normalizeBetRows([{aId:'12345678',realName:'private',nickname:'player',validBet:100,pay:500}],10);
 assert.deepEqual(Object.keys(rows[0]).sort(),['nickname','rank','score']);
 assert.equal(JSON.stringify(rows).includes('12345678'),false);
});
test('Backend cannot start syncing without an event start and game mappings',()=>{
 assert.ok(problems({account:'',session:'',password:'',vendorId:'',machine:{SET2:'',THOR:''},start:''}).length>0);
});
test('Escapes unsafe control characters in public nickname',()=>{
 assert.equal(cleanNickname('  play\nname\t'),'playname');
});

test('Local ingest removes accidental private fields before accepting rankings',()=>{
  const payload={version:1,source:'local-whitelisted-b2b',lastUpdated:new Date().toISOString(),
    rankings:{SET2:{BET:[{rank:1,nickname:'測試玩家',score:12345}],MULT:[]},
              THOR:{BET:[],MULT:[]}},unavailableModes:['MULT']};
  const valid=validatePublicSnapshot(payload);
  assert.equal(valid.testMode,true);
  assert.deepEqual(valid.rankings.SET2.BET,[{rank:1,nickname:'測試玩家',score:12345}]);
  assert.equal(JSON.stringify(valid).includes('password'),false);
  const invalid=structuredClone(payload);
  invalid.rankings.SET2.BET[0].aId='12345678';
  assert.throws(()=>validatePublicSnapshot(invalid),/unapproved_ranking_field/);
});
test('Reject invalid rank, duplicate rank and stale local submissions',()=>{
 const payload={version:1,source:'local-whitelisted-b2b',lastUpdated:new Date().toISOString(),
 rankings:{SET2:{BET:[{rank:1,nickname:'甲',score:100},{rank:1,nickname:'乙',score:90}],MULT:[]},
 THOR:{BET:[],MULT:[]}}};
 assert.throws(()=>validatePublicSnapshot(payload),/bad_ranking_score/);
 payload.rankings.SET2.BET=[{rank:1,nickname:'甲',score:-1}];
 assert.throws(()=>validatePublicSnapshot(payload),/bad_ranking_score/);
 payload.rankings.SET2.BET=[];
 payload.lastUpdated='2026-01-01T00:00:00.000Z';
 assert.throws(()=>validatePublicSnapshot(payload),/bad_snapshot_time/);
});
test('Secret token is never accepted when missing, malformed or too short',()=>{
 const previous=process.env.B2B_SYNC_TOKEN;
 process.env.B2B_SYNC_TOKEN='test-token-of-at-least-32-characters-signed';
 try{
  assert.equal(protectedTokenMatches('Bearer test-token-of-at-least-32-characters-signed'),true);
  assert.equal(protectedTokenMatches('Bearer incorrect-secret'),false);
  assert.equal(protectedTokenMatches(undefined),false);
 }finally{if(previous===undefined)delete process.env.B2B_SYNC_TOKEN;else process.env.B2B_SYNC_TOKEN=previous}
});

test('Sanitized RTP only accepts numeric machine percentages, never raw wagers or player objects',()=>{
 const base={version:1,source:'local-whitelisted-b2b',lastUpdated:new Date().toISOString(),
 rankings:{SET2:{BET:[],MULT:[]},THOR:{BET:[],MULT:[]}},
 unavailableModes:['MULT'],rtp:{SET2:88.49,THOR:264.01}};
 const valid=validatePublicSnapshot(base);
 assert.deepEqual(valid.rtp,{SET2:88.49,THOR:264.01});
 assert.equal(JSON.stringify(valid).includes('pay'),false);
 const empty=validatePublicSnapshot({...base,rtp:{SET2:null,THOR:null}});
 assert.deepEqual(empty.rtp,{SET2:null,THOR:null});
 const bad=structuredClone(base);bad.rtp.SET2={pay:500,bet:500};
 assert.throws(()=>validatePublicSnapshot(bad),/bad_rtp_value/);
 bad.rtp={SET2:99,THOR:100,accountId:'sensitive'};
 assert.throws(()=>validatePublicSnapshot(bad),/bad_rtp_schema/);
 bad.rtp={SET2:'88.49',THOR:100};
 assert.throws(()=>validatePublicSnapshot(bad),/bad_rtp_value/);
 bad.rtp={SET2:-1,THOR:100};
 assert.throws(()=>validatePublicSnapshot(bad),/bad_rtp_value/);
});
