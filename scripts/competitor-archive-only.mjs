import path from 'node:path';
import {prepareDashboardSnapshot} from './dashboard-snapshot.mjs';
import {buildCompetitorArchives} from './competitor-archive.mjs';
import {currentO8Attempt} from './o8-archive-only.mjs';
import {readArchiveJson,archiveTaipeiDay} from './o8-archive-store.mjs';
import {ARCHIVE_PLATFORM_KEYS,ARCHIVE_PROJECT_ROOT} from './competitor-archive-registry.mjs';
import {O8_LIVE_ROOT} from './run-o8-archive.mjs';

export async function buildCompetitorArchiveOnlySnapshot({previous=null,archiveStatuses=null,attemptStartedAt,root=ARCHIVE_PROJECT_ROOT,live=O8_LIVE_ROOT,now=()=>new Date(),loadPrevious=async()=>{try{return(await prepareDashboardSnapshot(root)).data;}catch{throw Error('archive_only_valid_full_snapshot_missing');}},buildArchives=buildCompetitorArchives,sourceProblems=[]}={}){
 const compiledAt=now(),statuses=archiveStatuses??await Promise.all(ARCHIVE_PLATFORM_KEYS.map(platform=>readArchiveJson(path.join(live,'competitor-archive',platform,'status.json')))),current=statuses.filter(status=>currentO8Attempt(status,attemptStartedAt,compiledAt));
 if(!current.length)return null;
 const base=previous??await loadPrevious();if(!base||typeof base!=='object'||Array.isArray(base)||!Array.isArray(base.platforms)||!Array.isArray(base.monthly)||!base.generatedAt)throw Error('archive_only_valid_full_snapshot_missing');
 const data=structuredClone(base),archives=await buildArchives(live,{policy:data.coinConversion,competitors:data.competitors,fundingScenarios:data.competitorFundingScenarios,asOf:archiveTaipeiDay(compiledAt)});
 data.competitorArchives=archives;data.competitorArchive=archives.platforms?.find(item=>item.platform==='o8')??data.competitorArchive;
 data.generatedAt=compiledAt.toISOString();const summaries=current.map(status=>Object.fromEntries(['platform','configured','status','lastAttemptAt','lastSuccessfulCaptureAt','lastSuccessfulRunAt','loginExpired','error','partial','enrichment','monthlyRanks'].filter(key=>status[key]!==undefined).map(key=>[key,status[key]])));
 data.update={...data.update,archiveOnly:true,partial:true,mode:'部分更新：競品逐日歸檔與執行狀態',archiveBaseGeneratedAt:base.generatedAt,archiveAttemptAt:current.map(item=>item.lastAttemptAt).sort().at(-1),archiveCompiledAt:data.generatedAt,competitorArchives:{schema:1,platforms:summaries},o8Archive:summaries.find(item=>item.platform==='o8')??data.update?.o8Archive,sourceGateReady:false,sourceProblems:[...sourceProblems],requirements:'原三站批次未通過核對，本次保留其前次資料及各來源時間；只更新競品歸檔與本次執行狀態。'};return data;
}
