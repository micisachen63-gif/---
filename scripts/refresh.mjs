import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {collect,ops,root} from './collect-data.mjs';
import {encodeDashboardTransport} from './transport-data.mjs';
import {runO8Archive} from './run-o8-archive.mjs';
import {buildCompetitorArchiveOnlySnapshot as buildArchiveOnlySnapshot} from './competitor-archive-only.mjs';
import {runCompetitorArchiveBatch} from './run-competitor-archive.mjs';
import {runDetailRefresh} from './detail-refresh.mjs';
import {safeDetailRefreshResult} from './detail-refresh-status.mjs';
import {runPromotionRefreshHook} from './promotion-refresh-hook.mjs';
import {runRefreshDomains} from './refresh-domains.mjs';
import {runOwnedFundingRefresh} from './owned-funding-refresh.mjs';
import {buildVerifiedRefreshOverlay} from './verified-refresh-overlay.mjs';

// This script never logs, persists, or obtains credentials. The owner-private
// Site's current supported service credential must arrive through stdin.
export const SITE_URL='https://royal-operations-observatory.smartangel12.chatgpt.site';
export function o8ArchiveHookBudget(startedAt,now=Date.now()){const remaining=23*60000-Math.max(0,now-startedAt);if(remaining<45000)return null;return{waitMs:Math.min(20*60000,remaining-45000),maxRunMs:Math.min(8*60000,remaining),maxTotalMs:remaining};}
export async function dailyO8ArchiveHook({startedAt=Date.now(),now=()=>Date.now(),runArchive=runO8Archive}={}){const budget=o8ArchiveHookBudget(startedAt,now());if(!budget)return{configured:null,status:'failed',error:'daily_deadline_budget',note:'原三站來源等待已消耗可用時間，未啟動額外瀏覽器作業。'};try{const result=await runArchive(budget);return Object.fromEntries(['configured','status','error','partial','enrichment','window','coveredDates','missingDates','failedDates','refreshedDates','lastAttemptAt','lastSuccessfulCaptureAt','lastSuccessfulRunAt','finishedAt','loginExpired'].filter(key=>result[key]!==undefined).map(key=>[key,result[key]]));}catch{return{configured:null,status:'failed',error:'archive_hook_failed',note:'發又發歸檔失敗；既有成功來源保留，原三站更新仍可繼續。'};}}
const NAMES=['贏麻了','茄子','爽爆'];
export async function dailyCompetitorArchiveHook({startedAt=Date.now(),runBatch=runCompetitorArchiveBatch,runFunding=runOwnedFundingRefresh,runDetails=runDetailRefresh,runPromotions=runPromotionRefreshHook,runToday,clock=()=>Date.now()}={}){
 const result=await runRefreshDomains({startedAt,runArchives:runBatch,runFunding,runDetails,runPromotions,runToday,clock});
 return{...result.archives,today:result.today,ownedFunding:result.ownedFunding,promotions:result.promotions,details:result.details};
}
const KEYS={贏麻了:'win',茄子:'qz',爽爆:'song'};
const read=async p=>JSON.parse((await fs.readFile(p,'utf8')).replace(/^\uFEFF/,''));
export function taipeiDay(now=new Date()) {
 const parts=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Taipei',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(now);
 const pick=t=>parts.find(p=>p.type===t).value;
 return `${pick('year')}-${pick('month')}-${pick('day')}`;
}
export function expectedThrough(day) {
 return new Date(Date.parse(day+'T00:00:00Z')-86400000).toISOString().slice(0,10);
}
export function checkStatus(status,day=taipeiDay()) {
 const problems=[];
 if(status.date!==day)problems.push('原營運排程尚未產出今日批次');
 if(status.through!==expectedThrough(day))problems.push('資料截止日並非昨日');
 if(status.mode!=='apply'||status.completed!==true||!status.finished)problems.push('原營運批次尚未完整結束');
 for(const name of NAMES){const row=status.platforms?.find(p=>p.platform===name);if(!row||row.state!=='verified'||row.warnings?.length)problems.push(name+' 尚未完成核對');}
 if(!status.runId||!/^[A-Za-z0-9_.-]+$/.test(status.runId))problems.push('來源批次識別碼無效');
 return {ready:problems.length===0,day,through:status.through||null,runId:status.runId||null,problems};
}
export async function inspectSource(day=taipeiDay()) {
 let status;
 try{status=await read(path.join(ops,'logs/latest.json'));}catch(e){if(e.code==='ENOENT')return {ready:false,day,problems:['找不到原營運批次狀態']};throw e;}
 const result=checkStatus(status,day);if(!result.ready)return result;
 const run=path.join(ops,'private/runs',status.runId);
 for(const name of NAMES){
  try{const source=await read(path.join(run,KEYS[name]+'-source.json'));if(!Array.isArray(source.daily)||!source.daily.some(r=>r[0]===status.through))result.problems.push(name+' 後台快照缺少昨日每日資料');}
  catch(e){if(e.code==='ENOENT')result.problems.push(name+' 後台快照缺漏');else throw e;}
 }
 result.ready=result.problems.length===0;return result;
}
export async function awaitRefreshInputs({day=taipeiDay(),startedAt=Date.now(),prepareOnly=false,noWait=false,inspect=inspectSource,archive=dailyCompetitorArchiveHook,now=()=>Date.now(),sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms)),sourceWaitMs=20*60000,onWait=()=>{}}={}){
 // Both branches start independently. The archive itself obeys the shared lock;
 // failure of the original three-site batch cannot prevent daily preservation.
 const archivePromise=prepareOnly?Promise.resolve({configured:null,status:'not_run',note:'prepare-only 不操作後台瀏覽器。'}):Promise.resolve().then(()=>archive({startedAt})).catch(()=>({configured:null,status:'failed',error:'archive_hook_failed'}));
 let source;try{source=await inspect(day);const deadline=now()+sourceWaitMs;while(!source.ready&&!noWait&&now()<deadline){onWait(source);await sleep(Math.min(60000,Math.max(1,deadline-now())));source=await inspect(day);}}catch{source={ready:false,day,problems:['原營運批次狀態讀取失敗'],sourceInspectionFailed:true};}
 const archives=await archivePromise;const o8Archive=archives.platforms?.find(item=>item.platform==='o8')??archives;return{source,o8Archive,competitorArchives:archives.platforms?archives:null};
}
const digest=text=>createHash('sha256').update(text).digest('hex');
export async function publishData(data,token,fetcher=fetch) {
 if(typeof token!=='string'||token.length<10||/[\r\n]/.test(token))throw Error('stdin 未提供有效的 Site service token');
 const serialized=JSON.stringify(encodeDashboardTransport(data));
 const headers={'OAI-Sites-Authorization':'Bearer '+token,'Content-Type':'application/json'};
 const endpoint=SITE_URL+'/api/data';
 const saved=await fetcher(endpoint,{method:'PUT',headers,body:serialized,redirect:'manual',signal:AbortSignal.timeout(60000)});
 if(!saved.ok)throw Error('Site 寫入失敗，HTTP '+saved.status);
 const receipt=await saved.json();if(receipt.ok!==true||receipt.generatedAt!==data.generatedAt)throw Error('Site 寫入回條不符');
 const result=await fetcher(endpoint,{headers:{'OAI-Sites-Authorization':'Bearer '+token,'Cache-Control':'no-cache'},redirect:'manual',signal:AbortSignal.timeout(60000)});
 if(!result.ok)throw Error('Site 讀回失敗，HTTP '+result.status);
 const actual=await result.text();if(digest(actual)!==digest(serialized))throw Error('Site 讀回內容與本機產出不符');
 return {ok:true,generatedAt:data.generatedAt,sha256:digest(serialized),bytes:Buffer.byteLength(serialized),months:data.monthly.length};
}
async function inputCredential(){
 let input='';for await(const chunk of process.stdin){input+=chunk;if(input.length>65536)throw Error('stdin 輸入過大');}
 try{return JSON.parse(input).token;}catch{throw Error('stdin 必須為僅包含 token 的 JSON 物件');}
}
export async function buildRefreshOutput({source,startedAt,day=taipeiDay(),o8Archive=null,competitorArchives=null,overlay=buildVerifiedRefreshOverlay,fullCollect=collect,inspect=inspectSource}={}){
 if(!source.ready){const data=await overlay({attemptStartedAt:startedAt,sourceProblems:source.problems,refreshResults:{today:competitorArchives?.today??null,ownedFunding:competitorArchives?.ownedFunding??null,competitorArchives,details:competitorArchives?.details??null,promotions:competitorArchives?.promotions??null}});if(!data)throw Error((source.problems??['沒有本次有效來源']).join('；'));return data;}
 const data=await fullCollect();
 const after=await inspect(day);if(!after.ready||after.runId!==source.runId)throw Error('收集期間原營運批次發生變動，保留網站既有資料並稍後重試');
 const stale=NAMES.filter(name=>data.platforms.find(p=>p.key===KEYS[name])?.dailyThrough!==source.through);
 if(stale.length)throw Error(stale.join('、')+' 合併後截止日不符');
 data.update={...data.update,schedule:'每日 08:00 · Asia/Taipei',mode:'原後台快照已核對，等待網站寫入驗證',sourceGateReady:true,sourceRun:source.runId,sourceThrough:source.through,sourceVerifiedAt:new Date().toISOString(),o8Archive,competitorArchives,requirements:'原 08:00 營運排程成功後推送；各模組依自身已核驗來源與截止日更新，失敗保留舊資料。'};return data;
}
export function publicationUpdateMode(update={}){
 if(update.statusOnly===true)return'僅更新本輪採集狀態；營運數據與來源時間保留原快照';
 if(update.partial===true||update.sourceGateReady===false||update.verifiedOverlay===true||update.archiveOnly===true)return Array.isArray(update.updatedDomains)&&update.updatedDomains.length?'部分更新：僅套用本輪已核驗區塊，其餘保留原截止日':'部分更新：各區塊依已核驗來源與實際截止日';
 return'依已核驗來源更新；各區塊截止日分開標示';
}
async function main(){
 const startedAt=Date.now(),args=new Set(process.argv.slice(2)),day=taipeiDay();
 if(args.has('--check-source')){const source=await inspectSource(day);console.log(JSON.stringify(source));if(!source.ready)process.exitCode=2;return;}
 // A scheduled agent calls --no-wait and performs <=60-second waits itself.
 // A standalone invocation can wait for the existing 08:00 collector, never rerun it.
 const {source,o8Archive,competitorArchives}=await awaitRefreshInputs({day,startedAt,prepareOnly:args.has('--prepare-only'),noWait:args.has('--no-wait'),onWait:value=>console.log(JSON.stringify({waiting:true,...value}))});
 const data=await buildRefreshOutput({source,startedAt,day,o8Archive,competitorArchives});
 if(args.has('--prepare-only')){await fs.writeFile(path.join(root,'data/dashboard.json'),JSON.stringify(data));console.log(JSON.stringify({prepared:true,source}));return;}
 const token=await inputCredential();
 data.update.mode=publicationUpdateMode(data.update);
 const receipt=await publishData(data,token);
 await fs.writeFile(path.join(root,'data/dashboard.json'),JSON.stringify(data));
 const preservedThrough=data.update.sourceThrough||data.platforms.filter(p=>Object.values(KEYS).includes(p.key)).map(p=>p.dailyThrough).filter(Boolean).sort()[0]||'unknown';
 const audit={...receipt,sourceRun:source.ready?source.runId:data.update.sourceRun||'archive-only-preserved',sourceThrough:source.ready?source.through:preservedThrough,archiveOnly:data.update.archiveOnly===true,archiveThrough:data.competitorArchive?.recentWindow?.through??null,site:SITE_URL,verifiedAt:new Date().toISOString()};
 await fs.mkdir(path.join(root,'data/refresh-audit'),{recursive:true});
 await fs.writeFile(path.join(root,'data/refresh-audit',day+'.json'),JSON.stringify(audit,null,2));
 console.log(JSON.stringify(audit));
}
if(process.argv[1]===fileURLToPath(import.meta.url))main().catch(error=>{console.error(JSON.stringify({ok:false,error:error.message}));process.exitCode=1;});
