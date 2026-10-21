import test from 'node:test';
import assert from 'node:assert/strict';
import {projectCompetitorRoleEvidence,applyConfirmedCompetitorRoles} from './competitor-role-evidence.mjs';
const role={platform:'o8',aid:'90000000004',nickname:'測試帳號33',role:'streamer',identityRoleConfirmed:true,merchantVerified:false,confirmationSource:'使用者直接明確確認',confirmedOnTaipei:'2026-10-21'};
test('published investigation retains period findings and role provenance without counterparty ledgers',()=>{
 const raw={roleConfirmations:[role],accounts:[{aid:role.aid,allPeers:[{aid:'private'}],daily:{series:[{observedIn:20,relatedEdges:[{to:'private'}]}]},periodComparison:{findings:['兩期皆未確認幣商'],periods:[{in:10,out:20,allPeers:[{aid:'private'}],sourceRows:[3]}]}}],periodReview:{platforms:[{allNodeMetrics:['private']}]}};
 const output=projectCompetitorRoleEvidence(raw),json=JSON.stringify(output);
 assert(!json.includes('private'));assert(!Object.hasOwn(output,'periodReview'));assert.equal(output.accounts[0].periodComparison.periods[0].out,20);assert.equal(output.roleConfirmations[0].confirmedOnTaipei,'2026-10-21');assert.equal(raw.accounts[0].allPeers.length,1);
});
test('streamer evidence removes only the matching platform account from inferred merchant lists',()=>{
 const group=platform=>({platform,candidates:[],weakEvidence:[{aid:role.aid}],coreHubs:[],edges:[{fromAid:role.aid,toAid:'other',coins:10}]});
 const original={platforms:[group('o8'),group('aos')]},output=applyConfirmedCompetitorRoles(original,{roleConfirmations:[role]});
 assert.equal(output.platforms[0].weakEvidence.length,0);assert.equal(output.platforms[0].edges.length,0);assert.equal(output.platforms[0].knownRoles[0].role,'streamer');assert.equal(output.platforms[0].knownRoles[0].merchantVerified,false);assert.equal(output.platforms[1].weakEvidence.length,1);assert.equal(original.platforms[0].weakEvidence.length,1);
});
test('unverified roles and merchant labels cannot promote or remove a merchant candidate',()=>{
 const original={platforms:[{platform:'o8',candidates:[{aid:role.aid,verified:false}],weakEvidence:[]}]};
 for(const patch of [{identityRoleConfirmed:false},{confirmationSource:'交易圖推測'},{role:'merchant'}]){const output=applyConfirmedCompetitorRoles(original,{roleConfirmations:[{...role,...patch}]});assert.equal(output.platforms[0].candidates.length,1);assert.equal(output.platforms[0].candidates[0].verified,false);}
});
