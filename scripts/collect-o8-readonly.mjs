import fs from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {O8_HEADER,O8_SOURCE_URL,sha256,validIsoDay,archiveTaipeiDay} from './o8-archive-store.mjs';
import {O8_CASH_HEADER,O8_GLOBAL_GIFT_HEADER,validateO8Enrichment} from './o8-archive-enrichment.mjs';

import {archiveSite} from './competitor-archive-registry.mjs';
import {validateCompetitorPageFrame} from './competitor-archive-pagination.mjs';
import {validateCompetitorEnrichment} from './competitor-archive-store.mjs';

const fail=code=>Object.assign(Error(code),{code});
export function readonlyQueryDeadline(external,kind,now=Date.now()){const limit=kind==='rank'?4*60000:120000;return Math.min(Number.isFinite(external)?external:now+limit,now+limit);}
const sameHeader=header=>JSON.stringify(header)===JSON.stringify(O8_HEADER);
export function normalizeO8VisibleTable(all,totalRows){const index=all.findIndex(row=>sameHeader(row)),raw=index>=0?all.slice(index+1):[],rows=raw.filter(row=>row.length!==1||!/(?:無數據|沒有資料|沒有符合的結果|No data|No results)/i.test(row[0]));const result={header:index>=0?all[index]:[],rows,totalRows};return{...result,signature:sha256(result)};}
export function validateO8PageFrame(frame,{page=1,pageSize=1000,totalRows=null}={}){
 if(!frame||!sameHeader(frame.header)||!Array.isArray(frame.rows)||!Number.isSafeInteger(frame.totalRows)||frame.totalRows<0)throw fail('report_controls_changed');
 if(totalRows!==null&&frame.totalRows!==totalRows)throw fail('pagination_not_verified');
 const expected=Math.min(pageSize,Math.max(0,frame.totalRows-(page-1)*pageSize)),first=(page-1)*pageSize+1;
 if(frame.rows.length!==expected||frame.rows.some((row,i)=>row.length!==O8_HEADER.length||!/^\d+$/.test(String(row[0]))||Number(row[0])!==first+i))throw fail('pagination_not_verified');
 return{page,rowCount:frame.rows.length,firstRank:frame.rows.length?first:null,lastRank:frame.rows.length?first+frame.rows.length-1:null,rankMode:'global',selectedPageVerified:true,rowSha256:sha256(frame.rows)};
}
export async function createReadonlyO8Adapter(options={}){return createReadonlyCompetitorAdapter({...options,platform:'o8'});}
export async function createReadonlyCompetitorAdapter({opsRoot,contextFactory=null,platform='o8',site:providedSite=null}={}){
 const site=providedSite??await archiveSite(platform),origin=site.url,givingUrl=origin+'/statements/giving';
 const attachStart=Date.now(),attachError=(cause,error)=>Object.assign(fail('browser_not_attached'),{phase:'attach_context',attachCause:cause,attachElapsedMs:Date.now()-attachStart,exceptionName:['Error','TimeoutError','TypeError','TargetClosedError'].includes(error?.name)?error.name:'OtherError'});
 let config;try{config=JSON.parse((await fs.readFile(path.join(opsRoot,'config.json'),'utf8')).replace(/^\uFEFF/,''));}catch(error){throw attachError('config_unreadable',error);}
 if(config.browserMode!=='attach'||config.localControlApproved!==true)throw attachError('config_gate');
 let create=contextFactory;if(!create)try{create=(await import(pathToFileURL(path.join(opsRoot,'runtime.mjs')).href)).browser;}catch(error){throw attachError('runtime_import_failed',error);}
 let context;try{context=await create(false);}catch(error){const cause=error?.name==='TimeoutError'?'connect_timeout':String(error?.message).includes('找不到專用瀏覽器工作階段')?'context_missing':String(error?.message).includes('請先開啟常駐登入視窗')?'cdp_connection_failed':String(error?.message).includes('隔離帳號')?'windows_account_mismatch':'runtime_attach_failed';throw attachError(cause,error);}if(!context||typeof context.newPage!=='function')throw attachError('context_missing');
 const owned=new Set();
 async function closePage(page){owned.delete(page);await page.close().catch(()=>{});}
 async function assertNoChallenge(page){const url=page.url(),title=await page.title().catch(()=>'');if(/^chrome-error:/i.test(url)||/Privacy error|Your connection is not private|您的連線不是私人連線|隱私權錯誤/i.test(title))throw fail('certificate_interstitial');const challenges=page.locator('iframe[src*="recaptcha"]:visible,iframe[src*="hcaptcha"]:visible,input[name*="captcha" i]:visible,input[placeholder*="驗證碼"]:visible,input[placeholder*="验证码"]:visible');if(await challenges.count())throw fail('captcha_required');}
 async function gotoReport(page){try{await page.goto(givingUrl,{waitUntil:'domcontentloaded',timeout:60000});}catch(error){if(/ERR_CERT|certificate/i.test(error.message))throw fail('certificate_interstitial');throw fail('browser_not_attached');}await assertNoChallenge(page);}
 async function openPage(){const page=await context.newPage();owned.add(page);page.setDefaultTimeout(45000);try{await gotoReport(page);await page.getByRole('tab',{name:'贈禮排行',exact:true}).waitFor({state:'visible',timeout:10000}).catch(()=>{});await assertNoChallenge(page);await assertLoggedIn(page);return page;}catch(error){await closePage(page);throw error;}}
 async function assertLoggedIn(page){let url;try{url=new URL(page.url());}catch{throw fail('login_required');}if(url.origin!==origin||url.pathname.replace(/\/$/,'')!=='/statements/giving'||await page.getByRole('tab',{name:'贈禮排行',exact:true}).count()!==1)throw fail('login_required');}
 async function restrictionVisible(page){return await page.getByText('起訖時間要限制今天以前7天內',{exact:false}).first().isVisible().catch(()=>false);}
 async function frame(page){
  const all=await page.getByRole('table').first().locator('tr').evaluateAll(rows=>rows.map(row=>[...row.querySelectorAll('th,td')].map(cell=>cell.textContent.trim())));
  const texts=await page.getByText(/Total Rows:\s*[\d,]+/).allTextContents(),counts=[...new Set(texts.map(text=>/Total Rows:\s*([\d,]+)/.exec(text)?.[1]).filter(Boolean).map(text=>Number(text.replaceAll(',',''))))];
  return normalizeO8VisibleTable(all,counts.length===1?counts[0]:null);
 }
 async function selectedPageProof(page,number){if(number===1)return null;const name='page '+number,control=page.getByRole('button',{name,exact:true});if(await control.count()!==1)return null;const value=await control.getAttribute('aria-current');if(['page','true'].includes(value))return{page:number,verified:true,method:'observed_active_pagination_control',accessibleName:name,attribute:'aria-current',value};return null;}
 async function waitFrame(page,{priorSignature=null,deadline=Date.now()+60000,pageNumber=1,totalRows=null,date=null,from=null,through=null}={}){
  const selectedFrom=from??date,selectedThrough=through??date;let stable=null,stableCount=0,sawUnverifiedEmpty=false;
  while(Date.now()<deadline){
   await assertLoggedIn(page);if(await restrictionVisible(page))throw fail('history_access_restricted');
   if(selectedFrom){const fields=page.getByRole('textbox'),values=await fields.evaluateAll(items=>items.map(input=>input.value));if(values[0]!==selectedFrom||values[1]!==selectedThrough||values[2]!==''||values[3]!=='')throw fail('date_mask_mismatch');}
   const value=await frame(page);try{validateCompetitorPageFrame(value,{page:pageNumber,pageSize:1000,totalRows,selectedPageProof:await selectedPageProof(page,pageNumber)});if(priorSignature!==null&&value.totalRows===0){sawUnverifiedEmpty=true;stable=null;stableCount=0;}else if(priorSignature===null||value.signature!==priorSignature){stableCount=value.signature===stable?stableCount+1:1;stable=value.signature;if(stableCount>=2)return value;}}catch(error){stable=null;stableCount=0;if(error.code!=='pagination_not_verified'&&error.code!=='report_controls_changed')throw error;}
   await page.waitForTimeout(400);
  }
  throw fail(sawUnverifiedEmpty?'empty_result_unverified':priorSignature?'unchanged_payload_unverified':'query_result_timeout');
 }
 async function captureDateRange(kind,from,through,{deadline=Date.now()+120000}={}){
  deadline=readonlyQueryDeadline(deadline,'range');
  const monthly=kind==='globalGiftMonthly';if(!(monthly?validIsoDay(from+'-01')&&validIsoDay(through+'-01')&&through<=archiveTaipeiDay().slice(0,7):validIsoDay(from)&&validIsoDay(through)&&through<archiveTaipeiDay())||from>through)throw fail('date_mask_mismatch');
  const isCash=kind==='cash',header=isCash?O8_CASH_HEADER:O8_GLOBAL_GIFT_HEADER,tab=isCash?'玩家消費':monthly?'月報表':'日報表',sourceUrl=isCash?origin+'/statements/player-summary':givingUrl,page=await context.newPage();owned.add(page);page.setDefaultTimeout(30000);
  async function read(){const tables=page.getByRole('table'),matches=[];for(let i=0;i<await tables.count();i++){const raw=await tables.nth(i).locator('tr').evaluateAll(items=>items.map(item=>[...item.querySelectorAll('th,td')].map(cell=>cell.textContent.trim()))),index=raw.findIndex(row=>JSON.stringify(row)===JSON.stringify(header));if(index>=0){const all=raw.slice(index+1),rows=all.filter(row=>(monthly?/^\d{4}-\d{2}$/:/^\d{4}-\d{2}-\d{2}$/).test(row[0])),footerRows=all.filter(row=>['加總','平均'].includes(row[0])),value={header,rows,footerRows};matches.push({...value,signature:sha256(value)});}}if(!matches.length)return null;if(new Set(matches.map(value=>value.signature)).size!==1)throw fail('report_controls_changed');return matches[0];}
  async function waitBaseline(){while(Date.now()<deadline){await assertNoChallenge(page);const value=await read();if(value)return value;await page.waitForTimeout(400);}throw fail('query_result_timeout');}
  try{
   try{await page.goto(sourceUrl,{waitUntil:'domcontentloaded',timeout:Math.max(1,Math.min(60000,deadline-Date.now()))});}catch(error){if(/ERR_CERT|certificate/i.test(error.message))throw fail('certificate_interstitial');throw fail('browser_not_attached');}
   await assertNoChallenge(page);await page.getByRole('tab',{name:tab,exact:true}).waitFor({state:'visible',timeout:10000}).catch(()=>{});
   if(new URL(page.url()).origin!==origin||await page.getByRole('tab',{name:tab,exact:true}).count()!==1)throw fail('login_required');await page.getByRole('tab',{name:tab,exact:true}).click();
   if(isCash){const all=page.getByRole('radio',{name:'All',exact:true});if(await all.count()!==1||!await all.isChecked()||await page.getByRole('button',{name:'全部',exact:true}).count()<1)throw fail('report_controls_changed');}
   else if(!monthly){const checkbox=page.getByRole('checkbox',{name:'新日報表',exact:true});if(await checkbox.count()!==1||!await checkbox.isChecked())throw fail('report_controls_changed');}
   const baseline=await waitBaseline(),fields=page.getByRole('textbox');if(await fields.count()<2)throw fail('report_controls_changed');for(const [index,value]of [[0,from],[1,through]]){await fields.nth(index).fill('');await fields.nth(index).fill(value);await fields.nth(index).press('Tab');}
   const selected=await fields.evaluateAll(items=>items.slice(0,2).map(input=>input.value));if(selected[0]!==from||selected[1]!==through)throw fail('date_mask_mismatch');await page.getByRole('button',{name:'送出',exact:true}).click();
   let stable=null,count=0;while(Date.now()<deadline){await assertNoChallenge(page);if(await restrictionVisible(page))throw fail('history_access_restricted');const dates=await fields.evaluateAll(items=>items.slice(0,2).map(input=>input.value));if(dates[0]!==from||dates[1]!==through)throw fail('date_mask_mismatch');const value=await read();if(value&&value.signature!==baseline.signature){const source={platform:site.key,from,through,tab,sourceUrl,capturedAt:new Date().toISOString(),header,rows:value.rows,footerRows:value.footerRows,complete:true,currentDayPartial:monthly&&through===archiveTaipeiDay().slice(0,7),currentMonthPartial:monthly&&through===archiveTaipeiDay().slice(0,7),queryProof:{selectedFrom:from,selectedThrough:through,verified:true,freshResultVerified:true,baselineSignature:baseline.signature,resultSignature:value.signature,filtersVerified:true,newDailyReport:isCash||monthly?undefined:true}};const checked=validateCompetitorEnrichment(source,site,kind);if(checked.valid){count=stable===value.signature?count+1:1;stable=value.signature;if(count>=2)return source;}else{count=0;stable=null;}}await page.waitForTimeout(400);}throw fail('query_result_timeout');
  }finally{await closePage(page);}
 }
 async function captureRankingRange(from,through,{deadline=Date.now()+4*60000}={}){
   deadline=readonlyQueryDeadline(deadline,'rank');
   if(!validIsoDay(from)||!validIsoDay(through)||from>through||through>=archiveTaipeiDay())throw fail('date_mask_mismatch');const page=await openPage();
   try{
    await page.getByRole('tab',{name:'贈禮排行',exact:true}).click();
    const size1000=page.getByRole('button',{name:'1000',exact:true});
    if(await size1000.count()!==1){const size50=page.getByRole('button',{name:'50',exact:true});if(await size50.count()!==1)throw fail('report_controls_changed');await size50.click();await page.getByRole('option',{name:'1000',exact:true}).click();}
    if(await size1000.count()!==1)throw fail('report_controls_changed');
    const before=await waitFrame(page,{deadline:Math.min(deadline,Date.now()+45000)}),fields=page.getByRole('textbox');if(await fields.count()!==4)throw fail('report_controls_changed');
    for(const [i,value]of [[0,from],[1,through]]){await fields.nth(i).fill('');await fields.nth(i).fill(value);await fields.nth(i).press('Tab');}for(const i of [2,3])await fields.nth(i).fill('');
    const values=await fields.evaluateAll(items=>items.map(input=>input.value));if(values[0]!==from||values[1]!==through||values[2]!==''||values[3]!=='')throw fail('date_mask_mismatch');
    await page.getByRole('button',{name:'送出',exact:true}).click();let current=await waitFrame(page,{priorSignature:before.signature,from,through,deadline:Math.min(deadline,Date.now()+60000)});
    const total=current.totalRows,firstFrameSignature=current.signature,pages=[],rows=[],signatures=new Set();
    for(let number=1;number<=Math.max(1,Math.ceil(total/1000));number++){
     if(number>25)throw fail('pagination_limit_exceeded');if(Date.now()>=deadline)throw fail('run_deadline_exceeded');
     const proof=validateCompetitorPageFrame(current,{page:number,pageSize:1000,totalRows:total,selectedPageProof:await selectedPageProof(page,number)});if(current.rows.length&&signatures.has(proof.rowSha256))throw fail('pagination_not_verified');signatures.add(proof.rowSha256);pages.push(proof);rows.push(...current.rows);
     if(rows.length>=total)break;
     const direct=page.getByRole('button',{name:'Go to page '+(number+1),exact:true}),next=page.getByRole('button',{name:'Go to next page',exact:true}),target=await direct.count()===1?direct:next;if(await target.count()!==1||await target.isDisabled())throw fail('pagination_not_verified');await target.click();current=await waitFrame(page,{priorSignature:current.signature,from,through,pageNumber:number+1,totalRows:total,deadline:Math.min(deadline,Date.now()+60000)});
    }
    const after=await fields.evaluateAll(items=>items.map(input=>input.value));if(after[0]!==from||after[1]!==through||after[2]!==''||after[3]!=='')throw fail('date_mask_mismatch');
    return{platform:site.key,from,through,sourceUrl:givingUrl,tab:'贈禮排行',capturedAt:new Date().toISOString(),header:O8_HEADER,rows,totalRows:total,complete:true,recentOnlyRestriction:site.recentOnlyRestriction,currentDayPartial:false,partial:false,queryProof:{selectedFrom:from,selectedThrough:through,verified:true,freshResultVerified:true,baselineSignature:before.signature,resultSignature:firstFrameSignature,emptyResultVerified:total===0,aidFiltersEmpty:true,selectorProof:'visible_date_textboxes_clear_fill_tab'},paginationProof:{pageSize:1000,totalRows:total,mode:pages.some(item=>item.rankMode==='page-local')?'ui_selected_page_local_ranks':'ui_global_ranks',pages}};
   }finally{await closePage(page);}
 }
 return{
  async checkLogin(){const page=await openPage();try{await assertLoggedIn(page);return{platform:site.key,authenticated:true,credentialsStored:false};}finally{await closePage(page);}},
  async captureCashRange(from,through,options){return captureDateRange('cash',from,through,options);},
  async captureGlobalGiftRange(from,through,options){return captureDateRange('globalGift',from,through,options);},
  async captureGlobalGiftMonthly(from,through,options){return captureDateRange('globalGiftMonthly',from,through,options);},
  async loginOnce(pair){
   let phase='open_report',page,users,passwords;const deadline=Date.now()+150000;
   const bounded=(promise,ms=150000)=>new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(fail('login_deadline_exceeded')),Math.max(1,Math.min(ms,deadline-Date.now())));Promise.resolve(promise).then(value=>{clearTimeout(timer);resolve(value);},error=>{clearTimeout(timer);reject(error);});});
   const step=value=>{phase=value;if(page)page.setDefaultTimeout(Math.max(1,Math.min(20000,deadline-Date.now())));};
   const work=async()=>{
    page=await context.newPage();owned.add(page);page.setDefaultTimeout(20000);await gotoReport(page);step('wait_initial');await page.waitForLoadState('networkidle',{timeout:15000}).catch(()=>{});await assertNoChallenge(page);
    if(await page.getByRole('tab',{name:'贈禮排行',exact:true}).isVisible().catch(()=>false))return{authenticated:true,alreadyAuthenticated:true,credentialsStored:false};
    users=page.locator('input[type=text]:visible,input[type=email]:visible,input:not([type]):visible');passwords=page.locator('input[type=password]:visible');
    if(new URL(page.url()).origin!==origin||await users.count()!==1||await passwords.count()!==1)throw fail('login_controls_changed');
    const typeInto=async(field,value)=>{await field.click();await field.fill('');await page.keyboard.type(value,{delay:40});};
    step('fill_username');await typeInto(users.first(),pair.username);step('fill_password');await typeInto(passwords.first(),pair.password);
    const lengths=await Promise.all([users.first().evaluate(input=>input.value.length),passwords.first().evaluate(input=>input.value.length)]);if(lengths[0]!==pair.username.length||lengths[1]!==pair.password.length)throw fail('login_controls_changed');
    step('submit_login');await assertNoChallenge(page);const submit=page.getByRole('button',{name:'登入',exact:true});if(await submit.count()!==1||await submit.isDisabled())throw fail('login_controls_changed');await submit.click();
    step('wait_postlogin');await page.waitForLoadState('networkidle',{timeout:20000}).catch(()=>{});await page.waitForTimeout(1200);await assertNoChallenge(page);if(await passwords.count())throw fail('login_rejected');
    step('verify_report');await gotoReport(page);await page.getByRole('tab',{name:'贈禮排行',exact:true}).waitFor({state:'visible',timeout:10000}).catch(()=>{});await assertNoChallenge(page);await assertLoggedIn(page);return{authenticated:true,alreadyAuthenticated:false,credentialsStored:false};
   };
   try{return await bounded(work());}catch(error){error.phase=phase;error.exceptionName=['Error','TimeoutError','TypeError','TargetClosedError'].includes(error.name)?error.name:'OtherError';if(page){const flags=async locator=>{if(!locator)return null;const values=await locator.evaluateAll(inputs=>inputs.slice(0,1).map(input=>({type:input.type,disabled:input.disabled===true,readOnly:input.readOnly===true,isEditable:input.disabled!==true&&input.readOnly!==true})));return values[0]||null;};const diagnostic=async()=>({username:await flags(users),password:await flags(passwords),dialogPresent:await page.getByRole('dialog').count()>0});const value=await Promise.race([diagnostic().catch(()=>null),new Promise(resolve=>setTimeout(()=>resolve(null),1000))]);if(value){error.fieldState={username:value.username,password:value.password};error.dialogPresent=value.dialogPresent;}}throw error;}
   finally{if(page){phase='cleanup';const finish=async()=>{const passwords=page.locator('input[type=password]:visible');if(await passwords.count().catch(()=>0))await passwords.first().fill('',{timeout:1000}).catch(()=>{});await closePage(page);};await new Promise(resolve=>{const timer=setTimeout(resolve,5000);finish().catch(()=>{}).finally(()=>{clearTimeout(timer);resolve();});});}}
  },
  async captureDay(date,options){return captureRankingRange(date,date,options);},
  async captureRankingRange(from,through,options){return captureRankingRange(from,through,options);},
  async close(){for(const page of [...owned])await closePage(page);await context.close();}
 };
}
