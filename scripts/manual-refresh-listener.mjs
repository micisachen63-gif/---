import fs from 'node:fs/promises';import path from 'node:path';import {fileURLToPath} from 'node:url';
import {decryptToken,PROJECT_ROOT,redactOutput} from './standalone-refresh.mjs';
import {SITE_URL,publishData} from './refresh.mjs';
import {buildVerifiedRefreshOverlay} from './verified-refresh-overlay.mjs';
import {acquireCollectorLock,collectDashboardReadonly} from './collect-dashboard-readonly.mjs';
import {runDetailRefresh} from './detail-refresh.mjs';
import {safeDetailRefreshResult,detailRefreshHasUpdates} from './detail-refresh-status.mjs';
import {runPromotionRefreshHook,promotionRefreshHasUpdates} from './promotion-refresh-hook.mjs';
import {runOwnedFundingRefresh} from './owned-funding-refresh.mjs';
import {runCompetitorArchiveBatch} from './run-competitor-archive.mjs';
import {runRefreshDomains,ownedFundingHasUpdates,archiveRefreshHasUpdates,archiveRefreshComplete,todayRefreshHasUpdates,todayRefreshComplete} from './refresh-domains.mjs';
import {atomicArchiveJson} from './o8-archive-store.mjs';
const PRIVATE=path.join(PROJECT_ROOT,'private'),STATE=path.join(PRIVATE,'manual-refresh-state.json');
export function queuedJob(value){const job=value?.job??value;if(!job||job.state!=='queued'||!/^[a-f\d]{8}-[a-f\d]{4}-[1-5][a-f\d]{3}-[89ab][a-f\d]{3}-[a-f\d]{12}$/i.test(job.id||''))return null;return job;}
export function completionState(platforms){const active=platforms.filter(p=>p.state!=='paused_by_user'),fresh=active.filter(p=>p.updatedViews?.length);return !fresh.length?'failed':active.every(p=>p.state==='succeeded')?'succeeded':'partial';}
export function manualCompletionState(platforms,details,promotions=null,ownedFunding=null,archives=null,today=null){const base=completionState(platforms);if(base==='failed'&&!detailRefreshHasUpdates(details)&&!promotionRefreshHasUpdates(promotions)&&!ownedFundingHasUpdates(ownedFunding)&&!archiveRefreshHasUpdates(archives)&&!todayRefreshHasUpdates(today))return'failed';return base==='succeeded'&&details.ok===true&&!details.partial&&(promotions===null||promotions.ok===true&&!promotions.partial)&&(ownedFunding===null||ownedFunding.ok===true)&&(archives===null||archiveRefreshComplete(archives))&&(today===null||todayRefreshComplete(today))?'succeeded':'partial';}
export async function queueRequest(token,method='GET',body,fetcher=fetch){
 const response=await fetcher(SITE_URL+'/api/refresh',{method,redirect:'manual',headers:{'OAI-Sites-Authorization':'Bearer '+token,'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(30000)});
 if(!response.ok)throw Error('手動刷新佇列 HTTP '+response.status);return response.json();
}
export async function persistVerifiedDashboard(data,{root=PROJECT_ROOT,write=atomicArchiveJson}={}){await write(path.join(root,'data/dashboard.json'),data);}
export async function processRefreshJob(job,token,{readOnly=collectDashboardReadonly,runDetails=runDetailRefresh,runPromotions=runPromotionRefreshHook,runFunding=runOwnedFundingRefresh,runArchives=runCompetitorArchiveBatch,runToday,startedAt=Date.now(),clock=()=>Date.now(),build=buildVerifiedRefreshOverlay,publish=publishData,persist=persistVerifiedDashboard,request=queueRequest,lock=acquireCollectorLock}={}){
 const release=await lock();if(!release)return {waiting:true,id:job.id};
 try{
  await request(token,'PATCH',{id:job.id,state:'running',startedAt:new Date().toISOString(),summary:'正從已授權後台重新查詢資料'});
  const domains=await runRefreshDomains({startedAt,lockHeld:true,runCurrent:readOnly,runFunding,runArchives,runPromotions,runDetails,runToday,clock}),result=domains.current??{platforms:[],capturedAt:null},{today,ownedFunding,archives,promotions,details}=domains;
  let state=manualCompletionState(result.platforms||[],details,promotions,ownedFunding,archives,today);const detailSummary=(todayRefreshComplete(today)?'十二站今日三項已取得新來源；':todayRefreshHasUpdates(today)?'部分站今日三項已取得新來源，未取得者保留未知；':'今日仍有來源缺口，保留各站採集時間；')+(details.ok?'明細更新完成':'明細部分失敗或未執行，保留各自截止日')+(promotions.ok?'；活動與儲值包更新完成':'；活動或儲值包有缺口，保留各自截止日')+(ownedFunding.ok?'；六站官儲與幣流已核對':'；自站官儲或幣流有缺口')+(archiveRefreshComplete(archives)?'；競品歸檔已核對':'；競品歸檔有缺口');
  const data=await build({attemptStartedAt:startedAt,sourceProblems:['手動刷新按各來源獨立核驗；不採用未驗證原營運批次。'],refreshResults:{today,ownedFunding,competitorArchives:archives,details,promotions}});
  if(data?.update?.statusOnly===true)state='failed';else if(state==='succeeded'&&(data?.update?.partial===true||data?.update?.sourceGateReady===false))state='partial';
  if(state==='failed'&&data?.update?.statusOnly!==true){await request(token,'PATCH',{id:job.id,state,summary:'總覽與明細均無可發布的新來源；網站保留前版。'+detailSummary,finishedAt:new Date().toISOString(),platforms:result.platforms});return {id:job.id,state,details};}
  if(!data)throw Error('本次來源無法安全套用到已驗證儀表盤，保留網站前版。');data.update={...data.update,mode:state==='failed'?'本次後台重抓失敗；僅更新執行狀態，原數據時間保留':state==='partial'?'部分更新：手動已核驗來源，其餘保留原截止日':'手動重新抓取後台',manualStatus:state,manualJobId:job.id,manualCapturedAt:result.capturedAt,platforms:result.platforms,details,promotions,today,ownedFunding,competitorArchives:archives,requirements:'各站與各模組依自身來源截止日；明細、活動或儲值包失敗或未重抓成功者沿用舊資料。站點暫停或恢復依使用者通知與實際登入結果核實。'};
  const receipt=await publish(data,token);await persist(data);await request(token,'PATCH',{id:job.id,state,summary:(state==='failed'?'本次沒有可套用的新營運數據；僅執行狀態已發布，舊數據與擷取時間保留；':state==='partial'?'部分來源已重新查詢並驗證；':'後台重新查詢與網站讀回均成功；')+detailSummary,finishedAt:new Date().toISOString(),platforms:result.platforms,verifiedAt:new Date().toISOString(),sha256:receipt.sha256});return {id:job.id,state,details,sha256:receipt.sha256};
 }catch(e){await request(token,'PATCH',{id:job.id,state:'failed',summary:redactOutput(String(e.message).slice(0,300),token),finishedAt:new Date().toISOString()}).catch(()=>{});throw e;}
 finally{await release();}
}
export async function listen(){
 await fs.mkdir(PRIVATE,{recursive:true});let state={};try{state=JSON.parse(await fs.readFile(STATE,'utf8'));}catch{};
 const log=path.join(PRIVATE,'manual-refresh-listener.log');
 for(;;){let token;try{
  token=await decryptToken();const job=queuedJob(await queueRequest(token));
  if(job&&job.id!==state.lastCompletedId){const result=await processRefreshJob(job,token);if(!result.waiting){state={lastCompletedId:job.id,...result,finishedAt:new Date().toISOString()};await fs.writeFile(STATE,JSON.stringify(state,null,2));}}
 }catch(e){await fs.appendFile(log,new Date().toISOString()+' '+redactOutput(String(e.message),token)+'\n');}finally{token=undefined;}
 await new Promise(resolve=>setTimeout(resolve,15000));}
}
if(process.argv[1]===fileURLToPath(import.meta.url))await listen();
