'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {normalizeBetRows,cleanNickname,problems}=require('./server');
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
