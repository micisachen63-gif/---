import fs from 'node:fs/promises';
import path from 'node:path';
import {DETAIL_PLATFORM_HOSTS,validDetailDate} from './detail-source-selection.mjs';
import {loadPlatformAvailability,platformCollectionPaused} from './platform-availability.mjs';

const KEYS=Object.keys(DETAIL_PLATFORM_HOSTS);
const KINDS=new Set(['ranks','members','machines']);
const ERRORS=new Set(['login_required','browser_not_attached','captcha_required','certificate_interstitial','report_controls_changed','date_mask_mismatch','query_result_timeout','unchanged_payload_unverified','pagination_not_verified','rank_cash_mismatch','source_validation_failed','collector_busy','run_deadline_exceeded','cleanup_failed','details_capture_failed','registration_capture_failed','registration_validation_failed','detail_hook_failed','source_status_unreadable','source_status_platform_mismatch']);
const stamp=value=>typeof value==='string'&&/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/.test(value)&&Number.isFinite(Date.parse(value))?value:null;
const count=value=>Number.isSafeInteger(value)&&value>=0?value:null;
const error=value=>value==null?null:ERRORS.has(value)?value:'details_capture_failed';
const key=value=>KEYS.includes(value)?value:null;
const date=value=>validDetailDate(value)?value:null;
export function safeDetailRefreshResult(value){
 const statuses=new Set(['success','partial_or_failed','collector_busy','failed','not_run']);
 const stages=(Array.isArray(value?.stages)?value.stages:[]).map(s=>({phase:['registration','current_closed_mtd','previous_comparison','previous_full_rank'].includes(s?.phase)?s.phase:'unknown',platform:key(s?.platform),from:date(s?.from),through:date(s?.through),status:['success','succeeded','partial','failed','not_run','not_comparable','existing_complete_source'].includes(s?.status)?s.status:'failed',...(typeof s?.ok==='boolean'?{ok:s.ok}:{}),updatedViews:(Array.isArray(s?.updatedViews)?s.updatedViews:[]).filter(v=>KINDS.has(v)),error:error(s?.error),errors:(Array.isArray(s?.errors)?s.errors:[]).map(e=>({kind:KINDS.has(e?.kind)?e.kind:null,error:error(e?.error)}))}));
 const ok=value?.ok===true&&value?.partial!==true&&value?.status==='success';
 return{schema:1,ok,busy:value?.busy===true,partial:!ok,status:statuses.has(value?.status)?value.status:'failed',startedAt:stamp(value?.startedAt),finishedAt:stamp(value?.finishedAt),platforms:(Array.isArray(value?.platforms)?value.platforms:[]).filter(p=>KEYS.includes(p)),stages,errors:(Array.isArray(value?.errors)?value.errors:[]).map(e=>({phase:['initial_budget','lock','registration','current_closed_mtd','previous_comparison','previous_full_rank','hook'].includes(e?.phase)?e.phase:'unknown',platform:key(e?.platform),from:date(e?.from),through:date(e?.through),error:error(e?.error)}))};
}
export function detailRefreshHasUpdates(value){return(value?.stages??[]).some(s=>(s.phase==='registration'&&s.ok===true)||(s.updatedViews?.length>0));}
export async function buildDetailRefreshStatus(live,{platforms=KEYS,availability=null}={}){
 availability??=await loadPlatformAvailability();
 const out=[];for(const platform of [...new Set(platforms)].filter(p=>KEYS.includes(p))){
  if(platformCollectionPaused(platform,availability)){out.push({platform,status:'paused_by_user',attemptedAt:null,finishedAt:null,entries:[],message:'使用者已確認後台暫時無法連線；保留既有資料，待通知恢復後補齊。'});continue;}
  const recovered=availability?.platforms?.[platform]?.state==='recovery_reported'?{availabilityState:'recovery_reported',message:'使用者已通知恢復；是否登入成功及資料更新，依實際採集結果核實。'}:{};
  let source;try{source=JSON.parse((await fs.readFile(path.join(live,'platform-details-archive',platform,'status.json'),'utf8')).replace(/^\uFEFF/,''));}catch(e){out.push({platform,status:e.code==='ENOENT'?'not_run':'failed',attemptedAt:null,finishedAt:null,entries:[],error:e.code==='ENOENT'?null:'source_status_unreadable',...recovered});continue;}
  if(source?.platform!==platform){out.push({platform,status:'failed',attemptedAt:null,finishedAt:null,entries:[],error:'source_status_platform_mismatch'});continue;}
  const entries=(Array.isArray(source.entries)?source.entries:[]).filter(e=>KINDS.has(e?.kind)&&date(e.from)&&date(e.through)&&e.from<=e.through).map(e=>({kind:e.kind,from:e.from,through:e.through,currentDayPartial:e.currentDayPartial===true,lastAttemptAt:stamp(e.lastAttemptAt),lastAttemptStatus:['succeeded','failed','not_run'].includes(e.lastAttemptStatus)?e.lastAttemptStatus:'failed',error:error(e.error),lastSuccessfulCaptureAt:stamp(e.lastSuccessfulCaptureAt),lastSuccessfulRows:count(e.lastSuccessfulRows)}));
  out.push({platform,status:['success','partial','failed','not_run'].includes(source.status)?source.status:'failed',partial:source.partial===true,attemptedAt:stamp(source.lastAttemptAt),finishedAt:stamp(source.finishedAt),entries,...recovered});
 }
 return{schema:1,platforms:out};
}
