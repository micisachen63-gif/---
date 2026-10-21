import fs from 'node:fs/promises';
import path from 'node:path';

// Only the evidence summary is delivered. Counterparty ledgers remain local.
const privateFields=new Set(['allPeers','relatedEdges','sourceRows','weeklySourceRows','allNodeMetrics']);
function summary(value){
 if(Array.isArray(value))return value.map(summary);
 if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).filter(([key])=>!privateFields.has(key)).map(([key,item])=>[key,summary(item)]));
 return value;
}
export function projectCompetitorRoleEvidence(raw){
 if(!raw||!Array.isArray(raw.accounts))return null;
 const fields=['schema','generatedAt','analysisDateTaipei','scope','roleConfirmations','definitions','revenueDecision','summary','accounts'];
 return summary(Object.fromEntries(fields.filter(key=>Object.hasOwn(raw,key)).map(key=>[key,raw[key]])));
}
export async function buildCompetitorRoleEvidence(liveDir){
 try{return projectCompetitorRoleEvidence(JSON.parse(await fs.readFile(path.join(liveDir,'competitor-weak-investigation-20261021.json'),'utf8')));}
 catch(error){if(error.code==='ENOENT')return null;throw error;}
}
export function applyConfirmedCompetitorRoles(network,evidence){
 const output=structuredClone(network);
 const roles=(evidence?.roleConfirmations??[]).filter(role=>role.identityRoleConfirmed===true&&role.role==='streamer'&&role.merchantVerified===false&&role.confirmationSource==='使用者直接明確確認');
 for(const group of output.platforms??[]){
  const known=roles.filter(role=>role.platform===group.platform),ids=new Set(known.map(role=>String(role.aid)));
  group.knownRoles=structuredClone(known);
  // A confirmed streamer role invalidates an inference based only on distribution.
  // It does not establish that the person never sells coins in another capacity.
  group.candidates=(group.candidates??[]).filter(account=>!ids.has(String(account.aid)));
  group.weakEvidence=(group.weakEvidence??[]).filter(account=>!ids.has(String(account.aid)));
  group.coreHubs=(group.coreHubs??[]).filter(account=>!ids.has(String(account.aid)));
  group.edges=(group.edges??[]).filter(edge=>!ids.has(String(edge.fromAid))&&!ids.has(String(edge.toAid)));
 }
 return output;
}
