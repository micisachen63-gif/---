import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHistoryPlan,mergeHistoryState,historyCoverageFromDashboard,HISTORY_KINDS} from './history-backfill.mjs';
import {archiveTaipeiDay,validIsoDay} from './o8-archive-store.mjs';
const ROOT=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const NAMES={win:'贏麻了',qz:'茄子',song:'爽爆',rd:'紅鑽',lucky:'來好運',bo:'來博',o8:'發又發',aos:'黑桃A',fcc:'財哥',cgb:'超吉爆',goldfun:'金來快',o9:'黑狗兄'};
const DOMAINS={ranks:'官儲排行',members:'新會員名單',machines:'機台報表',registration:'註冊人數',gift:'收贈排行',promotions:'活動福利',packages:'禮包',cash:'官儲日報',monthlyAudience:'月活躍／付費人數',activityComposition:'新舊活躍交集'};
const REASONS={login_required:'後台登入已失效',captcha_required:'登入需要驗證',certificate_interstitial:'後台連線需要確認',browser_not_attached:'專用登入視窗未連線',history_access_restricted:'後台限制歷史查詢',handler_missing:'尚無採集接口',monthly_audience_collector_missing:'尚無月活躍採集接口',login_aid_intersection_collector_missing:'尚無登入 AID 交集來源',registration_competitor_store_missing:'尚無競品歷史註冊採集接口',temporarily_unavailable:'後台暫時無法使用',rank_cash_mismatch:'排行與官儲日報未對平',pagination_not_verified:'分頁完整性未核對',date_mask_mismatch:'日期篩選未核對',stale_capture_returned:'來源採集時間未通過核對',query_result_timeout:'後台查詢逾時',task_interrupted:'前次採集已中斷',empty_result_unverified:'空結果尚未驗證',capture_validation_failed:'來源驗證未通過',source_validation_failed:'來源驗證未通過',capture_failed:'採集未完成',cleanup_failed:'採集結束確認未完成',run_deadline_exceeded:'本輪採集時間已用完'};
const timestamp=v=>typeof v==='string'&&Number.isFinite(Date.parse(v))?v:null;
const safeSources=(task,sources)=>Array.isArray(sources)&&sources.length>0&&sources.every(s=>s&&typeof s.file==='string'&&/^[A-Za-z0-9_./-]+\.json$/.test(s.file)&&!s.file.split('/').includes('..')&&!s.file.startsWith('/')&&validIsoDay(s.from)&&validIsoDay(s.through)&&timestamp(s.capturedAt)&&archiveTaipeiDay(new Date(s.capturedAt))>task.through&&(task.kind==='cash'?s.from<=task.from&&s.through>=task.through:s.through===task.through&&(s.from===task.from||task.kind==='monthlyAudience'&&task.platform==='win'&&task.month==='2026-01'&&s.from==='2026-01-01')));
function publicTask(t){
 const succeeded=t.state==='succeeded'&&['existing_verified_source','new_validated_capture'].includes(t.completionBasis)&&safeSources(t,t.sources),attempted=!!timestamp(t.lastAttemptAt),error=Object.hasOwn(REASONS,t.lastError)?t.lastError:null;
 let status='pending';if(succeeded)status='verified';else if(attempted&&['login_required','captcha_required'].includes(error))status='login_required';else if(t.state==='missing'&&error==='temporarily_unavailable')status='paused';else if(attempted&&error==='history_access_restricted')status='restricted';else if(attempted&&['handler_missing','monthly_audience_collector_missing','login_aid_intersection_collector_missing','registration_competitor_store_missing'].includes(error))status='no_interface';else if(attempted&&t.state==='running')status='running';else if(attempted&&['failed','missing'].includes(t.state))status='failed';
 return{month:t.month,domain:t.kind,from:t.from,through:t.through,status,attemptedAt:timestamp(t.lastAttemptAt),capturedAt:succeeded?timestamp(t.lastSuccessfulCaptureAt):null,sourceCount:succeeded?t.sources.length:0,sourcePeriods:succeeded?t.sources.map(s=>({from:s.from,through:s.through,capturedAt:s.capturedAt})):[],basis:succeeded?t.completionBasis:null,reason:succeeded?null:error?REASONS[error]:attempted&&status==='failed'?'採集未完成':null};
}
/** Safe DTO only: no filenames, raw records, paths, contacts, or exception text. */
export async function buildHistoryProgress(data={},options={}){
 const asOf=options.asOf??archiveTaipeiDay(),year=options.year??Number(asOf.slice(0,4)),plan=createHistoryPlan({year,today:asOf}),queueFile=options.queueFile??path.join(ROOT,'private',`history-backfill-${year}.json`);let queue=null,queueStatus='not_started';
 if(Object.hasOwn(options,'queue'))queue=options.queue;else try{queue=JSON.parse((await fs.readFile(queueFile,'utf8')).replace(/^\uFEFF/,''));}catch(error){if(error.code!=='ENOENT')queueStatus='unreadable';}
 if(queue){if(queue.schema===1&&queue.year===year&&Array.isArray(queue.tasks)){queueStatus='available';}else{queue=null;queueStatus='invalid';}}
 const known=new Map(plan.tasks.map(t=>[t.id,t]));
 // Treat the queue as evidence, never as an arbitrary source of platform/domain labels.
 if(queue)queue={...queue,tasks:queue.tasks.filter(t=>known.has(t?.id)&&t.platform===known.get(t.id).platform&&t.month===known.get(t.id).month&&t.kind===known.get(t.id).kind&&t.from===known.get(t.id).from&&t.through===known.get(t.id).through).map(t=>t.state==='succeeded'&&(!['existing_verified_source','new_validated_capture'].includes(t.completionBasis)||!safeSources(t,t.sources))?{...t,state:'failed',lastError:'source_validation_failed',completionBasis:null,sources:[]}:t)};
 const state=mergeHistoryState(plan,queue,{coveredSources:historyCoverageFromDashboard(data)}),months=[...new Set(plan.tasks.map(t=>t.month))],platforms=plan.platforms.map(key=>{
  const tasks=state.tasks.filter(t=>t.platform===key).map(publicTask),counts={};for(const t of tasks)counts[t.status]=(counts[t.status]||0)+1;
  return{platform:key,name:NAMES[key]||key,counts,months:months.map(month=>{const domains=tasks.filter(t=>t.month===month),verified=domains.filter(t=>t.status==='verified').length;return{month,verified,total:domains.length,complete:verified===domains.length,domains};})};
 });
 const all=platforms.flatMap(p=>p.months.flatMap(m=>m.domains)),counts={};for(const t of all)counts[t.status]=(counts[t.status]||0)+1;
 const attempted=all.filter(t=>t.attemptedAt).length;
 return{schema:1,year,asOf,scope:'closed_calendar_months_only',months,domains:HISTORY_KINDS.map(key=>({key,label:DOMAINS[key]})),platforms,total:all.length,counts,execution:{queueStatus,hasAttempts:attempted>0,attemptedTasks:attempted,lastAttemptAt:all.map(t=>t.attemptedAt).filter(Boolean).sort().at(-1)??null,lastUpdatedAt:queue?timestamp(queue.updatedAt):null},definition:'已後台驗證表示該月份來源完整、期間核對通過；不代表幣商身份或營收口徑已確認。官儲日報可逐日涵蓋月份；月活躍不以每日人數加總。',sourcePolicy:'backend_only'};
}
