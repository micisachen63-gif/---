import {runOwnedFundingRefresh,safeOwnedFundingResult,ownedFundingHasUpdates} from './owned-funding-refresh.mjs';
import {runCompetitorArchiveBatch} from './run-competitor-archive.mjs';
import {runPromotionRefreshHook} from './promotion-refresh-hook.mjs';
import {runDetailRefresh} from './detail-refresh.mjs';
import {safeDetailRefreshResult} from './detail-refresh-status.mjs';
import {DETAIL_PLATFORM_HOSTS} from './detail-source-selection.mjs';

const TOTAL=23*60000;
const todayRunner=async options=>(await import('./collect-today-progress.mjs')).runTodayProgress(options);
const todayStamp=value=>typeof value==='string'&&Number.isFinite(Date.parse(value))?value:null;
export function safeTodayRefresh(value){const statuses=['success','partial','failed','collector_busy'];return{schema:1,busy:value?.busy===true,status:statuses.includes(value?.status)?value.status:'failed',startedAt:todayStamp(value?.startedAt),finishedAt:todayStamp(value?.finishedAt),platforms:(value?.platforms??[]).filter(r=>Object.hasOwn(DETAIL_PLATFORM_HOSTS,r?.platform??'')).map(r=>({platform:r.platform,ok:r.ok===true,capturedAt:todayStamp(r.capturedAt),error:r.error==null?null:['login_required','captcha_required','certificate_interstitial','browser_not_attached','collector_busy','query_result_timeout','report_controls_changed','date_mask_mismatch','source_validation_failed','run_deadline_exceeded','cleanup_failed'].includes(r.error)?r.error:'today_capture_failed'}))};}
export function todayRefreshHasUpdates(value){return(value?.platforms??[]).some(r=>r.ok===true&&todayStamp(r.capturedAt));}
export function todayRefreshComplete(value){const keys=Object.keys(DETAIL_PLATFORM_HOSTS);return value?.status==='success'&&Array.isArray(value.platforms)&&value.platforms.length===keys.length&&new Set(value.platforms.map(r=>r.platform)).size===keys.length&&value.platforms.every(r=>keys.includes(r.platform)&&r.ok===true&&todayStamp(r.capturedAt));}
// The cap is measured from the same origin, while each phase receives only its
// own bounded share. No browser phase runs concurrently with another phase.
export function refreshPhaseLimit(startedAt,phaseMs,clock=Date.now()){
 const start=startedAt instanceof Date?startedAt.getTime():typeof startedAt==='string'?Date.parse(startedAt):startedAt;
 if(!Number.isFinite(start)||!Number.isFinite(phaseMs)||phaseMs<0)throw Error('refresh_invalid_budget');
 return Math.min(TOTAL,Math.max(0,clock-start)+phaseMs);
}
export function archiveRefreshHasUpdates(value){return(value?.platforms??[]).some(site=>(site.refreshedDates?.length>0)||Object.values(site.enrichment??{}).some(row=>row?.ok===true&&row.capturedAt)||(site.monthlyRanks?.windows??[]).some(row=>row.ok===true&&row.capturedAt));}
export function archiveRefreshComplete(value){return Array.isArray(value?.platforms)&&value.platforms.length>0&&value.platforms.every(row=>row.status==='success'&&row.partial!==true);}

export async function runRefreshDomains({startedAt=Date.now(),lockHeld=false,clock=()=>Date.now(),sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms)),runToday=todayRunner,runFunding=runOwnedFundingRefresh,runArchives=runCompetitorArchiveBatch,runCurrent=null,runPromotions=runPromotionRefreshHook,runDetails=runDetailRefresh}={}){
 let today;const todayLimit=refreshPhaseLimit(startedAt,3*60000,clock()),start=startedAt instanceof Date?startedAt.getTime():typeof startedAt==='string'?Date.parse(startedAt):startedAt;
 try{for(let attempt=0;attempt<12;attempt++){today=safeTodayRefresh(await runToday({startedAt,lockHeld,maxTotalMs:todayLimit,maxRunMs:3*60000}));if(!today.busy||lockHeld||attempt===11||start+todayLimit-clock()<45000)break;await sleep(Math.min(15000,Math.max(1,start+todayLimit-clock()-30000)));}}catch{today=safeTodayRefresh({status:'failed',platforms:[]});}
 let ownedFunding;try{ownedFunding=safeOwnedFundingResult(await runFunding({startedAt,lockHeld,waitMs:lockHeld?0:2*60000,maxTotalMs:refreshPhaseLimit(startedAt,4*60000,clock())}));}catch{ownedFunding=safeOwnedFundingResult({ok:false,platforms:[]});}
 let archives;try{archives=await runArchives({startedAt,lockHeld,fairBudget:true,maxTotalMs:refreshPhaseLimit(startedAt,8*60000,clock())});}catch{archives={schema:1,platforms:[],status:'failed',error:'archive_hook_failed'};}
 let current=null;if(runCurrent)try{const limit=refreshPhaseLimit(startedAt,3*60000,clock()),start=startedAt instanceof Date?startedAt.getTime():typeof startedAt==='string'?Date.parse(startedAt):startedAt;current=await runCurrent({lockHeld,deadline:start+limit});}catch{current={platforms:[],capturedAt:null};}
 // The activity hook already takes at most one third of the remaining window
 // (and at most five minutes), reserving the rest for registration/details.
 let promotions;try{promotions=await runPromotions({startedAt,lockHeld,maxTotalMs:TOTAL});}catch{promotions={ok:false,partial:true,error:'promotion_hook_failed',platforms:[]};}
 let details;try{details=safeDetailRefreshResult(await runDetails({startedAt,lockHeld,maxTotalMs:TOTAL}));}catch{details=safeDetailRefreshResult({ok:false,status:'failed',errors:[{phase:'hook',error:'detail_hook_failed'}]});}
 return{today,archives,ownedFunding,current,promotions,details};
}

export {ownedFundingHasUpdates};
