import fs from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL,fileURLToPath} from 'node:url';
import {randomUUID} from 'node:crypto';
import {ops} from './collect-data.mjs';
import {taipeiDay,expectedThrough} from './refresh.mjs';
import {normalizeDaily,parseBackendNumber,splitTodayProgress} from './backend-metrics.mjs';
import {loadPlatformAvailability,platformCollectionPaused} from './platform-availability.mjs';
import {boundedO8Operation} from './run-o8-archive.mjs';
export const LIVE='C:/Users/User/Documents/ChatGPT/outputs/01a15831-ccf2-7fc3-bbe2-813c2cd1dc71/live-data';
const EXTRA=[{key:'rd',name:'紅鑽'},{key:'lucky',name:'來好運'},{key:'bo',name:'來博'}];
const DAILY=['日期','DAU','DPU','總筆數','總金額','儲值率','ARPU','ARPPU','首儲人數','首儲總額'];
const CONSUME=['日期','MAU','MPU','總筆數','總金額','儲值率','ARPU','ARPPU','首儲人數','首儲總額'];
const ACTIVE=['日期','MAU','登入次數','登入/人','在線時數','時數/人','時數/登入'];
const numeric=v=>{const n=parseBackendNumber(v);if(n===null)throw Error('來源數值無效');return n;};
export function validateFreshTable(rows,{header,from,to,monthly=false,partialToday=null,completeThrough=null}){
 if(JSON.stringify(rows[0])!==JSON.stringify(header))throw Error('後台報表欄位不符');
 const pattern=monthly?/^\d{4}-\d{2}$/:/^\d{4}-\d{2}-\d{2}$/;
 const dated=rows.slice(1).filter(r=>pattern.test(r[0]));
 if(!dated.length||dated.some(r=>r[0]<from||r[0]>to||r.length!==header.length))throw Error('查詢結果日期或欄數不符');
 const partialMode=!monthly&&partialToday===to&&/^\d{4}-\d{2}-\d{2}$/.test(completeThrough||'')&&completeThrough<partialToday;
 const requiredTo=partialMode?completeThrough:to;
 const keys=new Set(dated.map(r=>r[0]));if(keys.size!==dated.length||(from<=requiredTo&&(!keys.has(from)||!keys.has(requiredTo)))||(!partialMode&&!keys.has(to)))throw Error('查詢起迄日尚未完整回傳');
 if(!monthly){for(let t=Date.parse(from+'T00:00:00Z');t<=Date.parse(requiredTo+'T00:00:00Z');t+=86400000)if(!keys.has(new Date(t).toISOString().slice(0,10)))throw Error('日報缺日，停止覆寫');}
 const cashIndex=header.indexOf('總金額'),values=cashIndex>=0?dated.map(r=>parseBackendNumber(r[cashIndex])):[];
 if(cashIndex>=0&&dated.some((r,i)=>values[i]===null&&(!partialMode||r[0]!==partialToday)))throw Error('完整日報儲值金額缺值');
 const cash=cashIndex>=0&&values.every(v=>v!==null)?values.reduce((s,n)=>s+n,0):null;
 const total=rows.find(r=>r[0]==='加總'),totalChecked=cash!==null&&!!total;
 if(totalChecked&&Math.abs(numeric(total[cashIndex])-cash)>0.01)throw Error('金額加總不符');
 return {rows:dated,cash,displayedTotalChecked:totalChecked,completeThrough:partialMode?completeThrough:to,todayPresent:partialMode?keys.has(partialToday):null,partialToday:partialMode?partialToday:null};
}
export function mergeHistory(prior,patch){
 const daily=new Map((prior.daily||[]).map(r=>[r[0],r]));for(const r of patch.daily||[])daily.set(r[0],r);
 const out={...prior,...patch,daily:[...daily.values()].filter(r=>!patch.completeThrough||r[0]<=patch.completeThrough).sort((a,b)=>a[0].localeCompare(b[0]))};
 if(patch.consumeDaily){
  const fresh=patch.consumeDaily,old=prior.consumeDaily??prior.tables?.consumeDaily;
  const oldRows=Array.isArray(old)?old.slice(1):old?.header?old.rows||[]:old?.rows?.slice(1)||[];
  // Preserve prior years/months outside the new query, but never relabel an old
  // today-row as fresh when today's query actually returned no row.
  const map=new Map(oldRows.filter(r=>/^\d{4}-\d{2}-\d{2}$/.test(r[0])&&(r[0]<fresh.from||r[0]>fresh.to)).map(r=>[r[0],r]));
  for(const r of fresh.rows)if(/^\d{4}-\d{2}-\d{2}$/.test(r[0]))map.set(r[0],r);
  const rows=[...map.values()].sort((a,b)=>a[0].localeCompare(b[0]));out.consumeDaily={...fresh,queriedFrom:fresh.from,queriedThrough:fresh.to,from:rows[0]?.[0]||fresh.from,to:rows.at(-1)?.[0]||fresh.to,rows};
 }
 for(const key of ['activeMonthly','consumeMonthly'])if(patch[key]){const old=prior[key]||{},map=new Map((old.rows||[]).filter(r=>/^\d{4}-\d{2}$/.test(r[0])).map(r=>[r[0],r]));for(const r of patch[key].rows)if(/^\d{4}-\d{2}$/.test(r[0]))map.set(r[0],r);out[key]={...patch[key],rows:[...map.values()].sort((a,b)=>a[0].localeCompare(b[0]))};}
 if(out.daily.length)out.period={from:out.daily[0][0],to:out.daily.at(-1)[0]};return out;
}
export async function acquireCollectorLock(){
 const lockFile=path.join(ops,'private/run.lock'),nonce=randomUUID();let handle;
 try{handle=await fs.open(lockFile,'wx');}catch(e){if(e.code==='EEXIST')return null;throw e;}
 await handle.writeFile(JSON.stringify({pid:process.pid,started:new Date().toISOString(),owner:'dashboard-readonly',nonce}));
 return async()=>{await handle.close();try{const current=JSON.parse(await fs.readFile(lockFile,'utf8'));if(current.nonce===nonce)await fs.unlink(lockFile);}catch(e){if(e.code!=='ENOENT')throw e;}};
}
async function sourceTable(context,p,view,from,to,header,openRoute,validationOptions={},outerDeadline=Infinity){
 if(Date.now()>=outerDeadline)throw Error('run_deadline_exceeded');
 const page=await context.newPage();page.setDefaultTimeout(Math.max(1,Math.min(60000,outerDeadline-Date.now())));page.setDefaultNavigationTimeout(Math.max(1,Math.min(60000,outerDeadline-Date.now())));
 try{
  await openRoute(page,p,'/statements/player-summary',undefined);
  const tab=page.getByRole('tab',{name:view,exact:true});await tab.click();
  // Each report uses a new page, preventing the previous query's rows from passing validation.
  const all=page.getByRole('radio',{name:'All',exact:true});if(await all.count())await all.check();
  const fields=page.getByRole('textbox');if(await fields.count()!==2)throw Error('報表日期欄位數量改變');
  for(const [i,value]of [[0,from],[1,to]]){await fields.nth(i).fill('');await fields.nth(i).fill(value);await fields.nth(i).press('Tab');}
  const actual=await fields.evaluateAll(es=>es.map(e=>e.value));if(actual[0]!==from||actual[1]!==to)throw Error('日期遮罩未接受指定起迄');
  await page.getByRole('button',{name:'送出',exact:true}).click();
  const deadline=Math.min(outerDeadline,Date.now()+60000);let lastError;
  while(Date.now()<deadline){
   const rows=await page.getByRole('table').last().locator('tr').evaluateAll(rs=>rs.map(r=>[...r.querySelectorAll('th,td')].map(c=>c.textContent.trim())));
   try{const valid=validateFreshTable(rows,{header,from,to,monthly:from.length===7,...validationOptions});return {header,rows:valid.rows,from,to,capturedAt:new Date().toISOString(),sourceUrl:p.url+'/statements/player-summary',view,validation:{queryDatesVerified:true,cashSum:valid.cash,displayedTotalChecked:valid.displayedTotalChecked,completeThrough:valid.completeThrough,partialToday:valid.partialToday,todayPresent:valid.todayPresent}};}catch(e){lastError=e;}
   await page.waitForTimeout(600);
  }
  throw lastError||Error('後台資料逾時');
 }finally{await page.close();}
}
export async function collectDashboardReadonly({lockHeld=false,live=LIVE,availability=null,deadline=Infinity}={}){
 availability??=await loadPlatformAvailability();
 const release=lockHeld?null:await acquireCollectorLock();if(!lockHeld&&!release)return {busy:true,platforms:[]};
 let context;const results=[];
 try{
  const config=JSON.parse(await fs.readFile(path.join(ops,'config.json'),'utf8'));
  if(config.browserMode!=='attach'||config.localControlApproved!==true)throw Error('未授權既有專用瀏覽器連線');
  const runtime=await import(pathToFileURL(path.join(ops,'runtime.mjs')).href),login=await import(pathToFileURL(path.join(ops,'login.mjs')).href);
  if(Date.now()>=deadline)throw Error('run_deadline_exceeded');
  context=await boundedO8Operation(runtime.browser(false),Math.max(1,Math.min(20000,deadline-Date.now())),'browser_not_attached');
  const day=taipeiDay(),completeThrough=expectedThrough(day),from=day.slice(0,7)+'-01',month=day.slice(0,7),year=day.slice(0,4)+'-01';
  for(const p of config.platforms.filter(p=>['win','song','qz'].includes(p.key))){
   const capturedAt=new Date().toISOString();let patch={platform:p.key,name:p.name,capturedAt,sourceUrl:p.url+'/statements/player-summary',manualRefresh:true},errors=[];
   for(const [key,view,start,end,header]of [['consumeDaily','玩家消費',from,day,DAILY],['consumeMonthly','玩家消費(月)',year,month,CONSUME],['activeMonthly','玩家活躍(月)',year,month,ACTIVE]]){
    try{if(Date.now()>=deadline)throw Error('run_deadline_exceeded');const table=await sourceTable(context,p,view,start,end,header,login.openRoute,key==='consumeDaily'?{partialToday:day,completeThrough}:{},deadline);patch[key]=table;if(key==='consumeDaily'){const split=splitTodayProgress(normalizeDaily(table),{platform:p.key,capturedAt:table.capturedAt,sourceUrl:table.sourceUrl},day);patch.daily=split.daily;patch.dailyToday=split.todayProgress;patch.completeThrough=completeThrough;patch.queriedThrough=day;}}catch(e){errors.push({view,summary:e.kind?'後台需重新登入或權限不足':String(e.message).slice(0,200)});}
   }
   const count=['consumeDaily','consumeMonthly','activeMonthly'].filter(k=>patch[k]).length;
   const todayKnown=typeof patch.dailyToday?.todayCash==='number'&&Number.isFinite(patch.dailyToday.todayCash);
   if(patch.consumeDaily&&!todayKnown)errors.push({view:'玩家消費',summary:'今日來源缺列或儲值未知；完整日報可更新，今日不補0。'});
   if(count){const filename=path.join(live,'backend-history-'+p.key+'.json');let prior={};try{prior=JSON.parse(await fs.readFile(filename,'utf8'));}catch(e){if(e.code!=='ENOENT')throw e;}await fs.writeFile(filename,JSON.stringify(mergeHistory(prior,patch),null,2));}
   results.push({key:p.key,name:p.name,state:count===3&&todayKnown?'succeeded':count?'partial':'failed',capturedAt:count?capturedAt:null,dailyThrough:patch.daily?.at(-1)?.[0]||null,todayThrough:patch.dailyToday?.date||null,todayKnown,queriedThrough:patch.consumeDaily?day:null,monthlyThrough:patch.consumeMonthly?day:null,updatedViews:['consumeDaily','consumeMonthly','activeMonthly'].filter(k=>patch[k]),errors});
  }
 }catch(e){for(const key of ['win','song','qz'])if(!results.some(p=>p.key===key))results.push({key,state:'failed',summary:String(e.message).slice(0,200)});}
 finally{if(context)await boundedO8Operation(context.close(),8000,'cleanup_failed').catch(()=>{});if(release)await release();}
 for(const p of EXTRA)results.push({...p,state:platformCollectionPaused(p.key,availability)?'paused_by_user':'partial',updatedViews:[],summary:platformCollectionPaused(p.key,availability)?'使用者已確認後台暫時無法連線；暫停查詢，保留既有資料，待通知恢復後補齊。':(availability?.platforms?.[p.key]?.state==='recovery_reported'?'使用者已通知恢復，登入與資料更新仍待實際核實。':'')+'此步驟未重抓本站每日總覽；付費名單、會員分群與機台由後續明細更新獨立回報，既有來源截止日保留。'});
 return {busy:false,capturedAt:new Date().toISOString(),platforms:results,successful:results.filter(p=>p.updatedViews?.length).length};
}
if(process.argv[1]===fileURLToPath(import.meta.url))console.log(JSON.stringify(await collectDashboardReadonly()));
