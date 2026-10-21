import path from 'node:path';
import {prepareDashboardSnapshot} from './dashboard-snapshot.mjs';
import {buildCompetitorArchive} from './competitor-archive.mjs';
import {readArchiveJson,archiveTaipeiDay} from './o8-archive-store.mjs';
import {O8_LIVE_ROOT,O8_PROJECT_ROOT} from './run-o8-archive.mjs';

export function currentO8Attempt(status,attemptStartedAt,now=new Date()){
 const started=typeof attemptStartedAt==='number'?attemptStartedAt:Date.parse(attemptStartedAt),attempt=Date.parse(status?.lastAttemptAt),current=now instanceof Date?now.getTime():Date.parse(now);
 return status?.configured===true&&['success','failed','login_required','configured_unverified'].includes(status.status)&&Number.isFinite(started)&&Number.isFinite(attempt)&&attempt>=started-2000&&attempt<=current+2000;
}
export async function buildArchiveOnlySnapshot({previous=null,archiveStatus=null,attemptStartedAt,root=O8_PROJECT_ROOT,live=O8_LIVE_ROOT,now=()=>new Date(),loadPrevious=async()=>{try{return(await prepareDashboardSnapshot(root)).data;}catch{throw Error('archive_only_valid_full_snapshot_missing');}},buildArchive=buildCompetitorArchive,sourceProblems=[]}={}){
 const compiledAt=now(),status=archiveStatus??await readArchiveJson(path.join(live,'competitor-archive/o8/status.json'));
 if(!currentO8Attempt(status,attemptStartedAt,compiledAt))return null;
 const base=previous??await loadPrevious();if(!base||typeof base!=='object'||Array.isArray(base)||!Array.isArray(base.platforms)||!Array.isArray(base.monthly)||!base.generatedAt)throw Error('archive_only_valid_full_snapshot_missing');
 const data=JSON.parse(JSON.stringify(base)),archive=await buildArchive(live,{policy:data.coinConversion,competitors:data.competitors,fundingScenarios:data.competitorFundingScenarios,asOf:archiveTaipeiDay(compiledAt)});
 // The archive builder reads only validated o8 sources. No collect(), original
 // three-platform run files, balances, or prior source timestamps are rewritten.
 data.competitorArchive=archive;data.generatedAt=compiledAt.toISOString();data.update={...data.update,archiveOnly:true,partial:true,mode:'部分更新：僅發又發逐日歸檔與執行狀態',archiveBaseGeneratedAt:base.generatedAt,archiveAttemptAt:status.lastAttemptAt,archiveCompiledAt:data.generatedAt,o8Archive:{configured:true,status:status.status,lastAttemptAt:status.lastAttemptAt,lastSuccessfulCaptureAt:status.lastSuccessfulCaptureAt??null,loginExpired:status.loginExpired??null,error:status.error??null},sourceGateReady:false,sourceProblems:[...sourceProblems],requirements:'原三站批次未通過核對，本次保留其前次資料及各來源時間；只更新發又發歸檔與本次執行狀態。'};return data;
}
