import {PRIVATE_ROSTERS} from './private-rosters.mjs';
import fs from 'node:fs/promises';
import path from 'node:path';
import {parseCompetitorNetworkSource} from './competitor-merchant-network.mjs';
import {COMPETITOR_SCENARIO_ROSTER,COMPETITOR_SCENARIO_MODEL_VERSION,parseCompetitorCashSource,parseCompetitorFundingSource} from './competitor-funding.mjs';
import {normalizeDaily,splitTodayProgress,currentTaipeiDay,parseBackendNumber} from './backend-metrics.mjs';
import {convertCoins,loadCoinConversionPolicy} from './coin-conversion.mjs';

const SITES={o8:{name:'發又發',host:'admin.8o8.tw:9955'},aos:{name:'黑桃A',host:'admin.aos888.com:9955'},fcc:{name:'財哥',host:'admin.fcc99.com:9955'},cgb:{name:'超吉爆',host:'admin.cgb777.com:9955'},goldfun:{name:'金來快',host:'admin.goldfun88.com:9955'},o9:{name:'黑狗兄',host:'admin.o9play.com:9955'}},LEGACY_BEFORE='2026-10-21';
const validDate=s=>typeof s==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(s)&&Number.isFinite(Date.parse(s))&&new Date(s).toISOString().slice(0,10)===s;
const day=t=>typeof t==='string'&&Number.isFinite(Date.parse(t))?new Date(Date.parse(t)+8*3600000).toISOString().slice(0,10):null;
const int=v=>(typeof v==='number'||typeof v==='string'&&/^\d+$/.test(v))&&Number.isSafeInteger(Number(v))?Number(v):null;
const numeric=v=>typeof v==='number'&&Number.isFinite(v)?v:null;
const shift=(d,n)=>new Date(Date.parse(d)+n*86400000).toISOString().slice(0,10);
function dates(from,through){const out=[];if(!validDate(from)||!validDate(through)||from>through)return out;for(let d=from;d<=through;d=shift(d,1))out.push(d);return out;}
function exactUrl(url,route,platform='o8'){try{const u=new URL(url);return u.protocol==='https:'&&u.host===SITES[platform]?.host&&u.pathname.replace(/\/$/,'')===route&&!u.username&&!u.password;}catch{return false;}}
const newest=list=>list.sort((a,b)=>Date.parse(b.capturedAt)-Date.parse(a.capturedAt)||String(a.file).localeCompare(String(b.file)))[0]??null;
const sumKnown=(rows,key)=>rows.length&&rows.every(r=>numeric(r[key])!==null)?rows.reduce((s,r)=>s+r[key],0):null;
const fallbackRoles=PRIVATE_ROSTERS.excludedRoles.o8??[];

export function parseArchiveDailySource(file,data,{asOf=currentTaipeiDay(),platform='o8'}={}){
 const normalized=file.replaceAll('\\','/'),match=new RegExp('gift-daily-rank-'+platform+'-(\\d{4}-\\d{2}-\\d{2})\\.json$').exec(normalized)??/\/daily\/(\d{4}-\d{2}-\d{2})\/[^/]+\.json$/.exec(normalized),date=match?.[1]??null;
 const source=parseCompetitorNetworkSource(`gift-daily-rank-${platform}-${date}.json`,data),issues=[...source.issues],add=s=>{if(!issues.includes(s))issues.push(s);};
 if(!match||data?.platform!==platform||data?.from!==date||data?.through!==date)add('archive_daily_filename_or_period_mismatch');
 if(!validDate(date)||date>=asOf||date>=source.captureDate||source.partial)add('daily_source_not_closed_at_capture');
 if(source.captureDate>asOf)add('capture_after_analysis_day');
 const p=data?.paginationProof,n=int(data?.totalRows),size=int(p?.pageSize),pages=p?.pages,rank=Array.isArray(data?.header)?data.header.indexOf('名次'):-1;
 let paginationValidation={valid:false,mode:'missing',selectedPageProofAvailable:false};
 if(p){
  const before=issues.length;
  if(size===null||size<=0||n===null||n<0||int(p.totalRows)!==n||!Array.isArray(pages))add('pagination_proof_invalid');
  else{
   if(pages.length!==Math.max(1,Math.ceil(n/size)))add('pagination_page_count_mismatch');
   for(let i=0;i<pages.length;i++){const page=pages[i],count=Math.min(size,Math.max(0,n-i*size)),local=page.rankMode==='page-local',start=local?1:i*size+1;
    if(int(page.page)!==i+1||int(page.rowCount)!==count)add('pagination_page_rows_mismatch');
    if(local&&i>0&&page.selectedPageVerified!==true)add('page_local_selection_not_verified');
    if(count&&(int(page.firstRank)!==start||int(page.lastRank)!==start+count-1))add('pagination_rank_range_mismatch');
    const rows=data.rows?.slice(i*size,i*size+count);if(rank<0||!Array.isArray(rows)||rows.length!==count||rows.some((r,j)=>int(r[rank])!==start+j))add('source_rank_sequence_mismatch');
   }
  }paginationValidation={valid:issues.length===before,mode:'explicit_pagination',selectedPageProofAvailable:pages?.slice(1).every(p=>p.selectedPageVerified===true)??false};
 }else if(source.captureDate&&source.captureDate<LEGACY_BEFORE&&n!==null&&n>=0&&n<=1000&&Array.isArray(data?.rows)&&data.rows.length===n&&rank>=0&&data.rows.every((r,i)=>int(r[rank])===i+1)){
  paginationValidation={valid:true,mode:'legacy_single_page_total_rows',selectedPageProofAvailable:false,reportedTotalRows:n,observedRows:n,limitation:'舊來源保留Total Rows、完整單頁序號及日期核驗，未保留選中頁證據；不捏造paginationProof。'};
 }else add('pagination_proof_missing');
 return{...source,file,date,complete:issues.length===0,issues,paginationProof:p?structuredClone(p):null,paginationValidation,queryProof:data?.queryProof?structuredClone(data.queryProof):null};
}
function compactSource(doc){const {rows,registrationTable,...metadata}=doc;return{...metadata,sourceRowCount:Array.isArray(rows)?rows.length:Array.isArray(registrationTable)?registrationTable.length:null,rawStoredPrivately:true};}
function dailyMeta(s){return s?{file:s.file,from:s.from,through:s.through,capturedAt:s.capturedAt,sourceUrl:s.sourceUrl,complete:s.complete,partial:s.partial,totalRows:s.totalRows,rowCount:s.rowCount,queryProof:s.queryProof,paginationProof:s.paginationProof,paginationValidation:s.paginationValidation,validation:s.validation,issues:s.issues}:null;}
function safeMonthlyRankStatus(value,platform){
 if(!value||typeof value!=='object'||Array.isArray(value))return null;
 const flag=v=>v===true?true:v===false?false:null,code=(v,fallback)=>v==null?null:typeof v==='string'&&/^[a-z0-9_]{1,80}$/.test(v)?v:fallback,stamp=v=>typeof v==='string'&&Number.isFinite(Date.parse(v))?v:null,roles=new Set(['current_month_closed','previous_comparison','previous_full_month_missing']);
 const windows=(Array.isArray(value.windows)?value.windows:[]).filter(w=>w&&typeof w==='object'&&!Array.isArray(w)).map(w=>{
  const from=validDate(w.from)?w.from:null,through=validDate(w.through)?w.through:null,expected=from&&through?`competitor-period-rank-${platform}-${from}_${through}.json`:null,file=typeof w.file==='string'?path.posix.basename(w.file.replaceAll('\\','/')):null;
  return{from,through,roles:[...new Set((Array.isArray(w.roles)?w.roles:[]).filter(r=>roles.has(r)))],ok:flag(w.ok),capturedAt:stamp(w.capturedAt),error:code(w.error,'report_failed'),...(expected&&file===expected?{file}:{} )};
 });
 return{required:value.required===true,complete:flag(value.complete),previousComparable:flag(value.previousComparable),reason:code(value.reason,'monthly_rank_status_unavailable'),windows};
}

export function parseArchiveGiftSummary(file,data,{asOf=currentTaipeiDay(),platform='o8'}={}){
 const sourceUrl=data?.sourceUrl??null,capturedAt=data?.capturedAt??null,captureDate=day(capturedAt),from=data?.from,through=data?.through,p=data?.queryProof,issues=[],monthQuery=/^\d{4}-\d{2}$/.test(String(from))&&/^\d{4}-\d{2}$/.test(String(through));
 const periodFrom=monthQuery?from+'-01':from,periodThrough=monthQuery&&captureDate?(through===captureDate.slice(0,7)?captureDate:new Date(Date.UTC(Number(through.slice(0,4)),Number(through.slice(5)),0)).toISOString().slice(0,10)):through;
 if(data?.platform!==platform||!exactUrl(sourceUrl,'/statements/giving',platform))issues.push('untrusted_global_gift_source');
 if(!validDate(periodFrom)||!validDate(periodThrough)||periodFrom>periodThrough||!captureDate||periodThrough>captureDate||captureDate>asOf)issues.push('global_gift_period_or_capture_invalid');
 if(data?.complete!==true||p?.verified!==true||p.selectedFrom!==from||p.selectedThrough!==through)issues.push('global_gift_date_or_completeness_not_verified');
 const header=data?.header,rawRows=data?.rows,dateCol=Array.isArray(header)?header.indexOf('日期'):-1,columns={totalGiftCoins:'新贈禮總金額',feeCoins:'新總手續費',giverCount:'總贈禮人數',receiverCount:'總收禮人數',giftTransactions:'總贈禮筆數',successfulGiftTransactions:'成功贈禮筆數'};
 if(dateCol<0||!Array.isArray(rawRows)||header.indexOf(columns.totalGiftCoins)<0)issues.push('global_gift_columns_missing');
 const daily=[],monthly=[],seen=new Set();
 if(!issues.length)for(const row of rawRows){const date=String(row[dateCol]??'').trim(),isDaily=validDate(date),isMonthly=/^\d{4}-\d{2}$/.test(date);if(!isDaily&&!isMonthly)continue;
  if(seen.has(date)){issues.push('duplicate_global_gift_period');continue;}seen.add(date);
  const month=isMonthly?date:date.slice(0,7),monthEnd=new Date(Date.UTC(Number(month.slice(0,4)),Number(month.slice(5)),0)).toISOString().slice(0,10),rowFrom=isDaily?date:month+'-01',rowThrough=isDaily?date:(periodThrough<monthEnd?periodThrough:monthEnd);
  if(rowFrom<periodFrom||rowThrough>periodThrough||rowFrom>rowThrough){issues.push('global_gift_row_outside_selected_period');continue;}
  const values=Object.fromEntries(Object.entries(columns).map(([k,label])=>[k,parseBackendNumber(row[header.indexOf(label)])]));
  if(values.totalGiftCoins===null||Object.values(values).some(v=>v!==null&&v<0)){issues.push('invalid_global_gift_number');continue;}
  const partial=rowThrough>=captureDate||rowThrough>=asOf||isMonthly&&data.currentMonthPartial===true&&month===captureDate.slice(0,7),entry={...(isDaily?{date}:{month}),from:rowFrom,through:rowThrough,...values,givenCoins:null,receivedCoins:null,complete:!partial,partial,capturedAt,sourceFiles:[file],sourceUrl,source:{file,from,through,capturedAt,queryProof:structuredClone(p),tab:data.tab??null}};
  (isDaily?daily:monthly).push(entry);
 }
 return{file,from,through,capturedAt,sourceUrl,complete:issues.length===0,issues,daily:issues.length?[]:daily,monthly:issues.length?[]:monthly,raw:{header:Array.isArray(header)?structuredClone(header):[],rows:Array.isArray(rawRows)?structuredClone(rawRows):[],queryProof:p?structuredClone(p):null,tab:data?.tab??null}};
}

function coverage(expected,covered){const present=new Set(covered),months=[...new Set(expected.map(d=>d.slice(0,7)))];return{coveredDates:expected.filter(d=>present.has(d)),missingDates:expected.filter(d=>!present.has(d)),months:months.map(month=>{const all=expected.filter(d=>d.startsWith(month)),known=all.filter(d=>present.has(d));return{month,expectedDays:all.length,coveredDays:known.length,missingDates:all.filter(d=>!present.has(d)),complete:known.length===all.length};})};}
function cashRows(sources,asOf,platform){
 const map=new Map(),rejected=[];
 for(const s of sources){if(s.validation?.valid===false||!exactUrl(s.sourceUrl,'/statements/player-summary',platform)){rejected.push({file:s.file??null,issues:s.validation?.issues??['untrusted_cash_source']});continue;}
  let rows=[];try{rows=splitTodayProgress(s.rows??[],s,asOf).daily;}catch{rejected.push({file:s.file??null,issues:['duplicate_or_invalid_cash_dates']});continue;}
  for(const row of rows){if(numeric(row[4])===null||row[4]<0)continue;const old=map.get(row[0]);if(!old||Date.parse(s.capturedAt)>Date.parse(old.capturedAt))map.set(row[0],{date:row[0],value:row[4],capturedAt:s.capturedAt,sourceUrl:s.sourceUrl,file:s.file??null,queryProof:s.queryProof??null});}
 }return{map,rejected};
}
function summarize(rows,expected,policy,platform){
 const complete=expected.length>0&&rows.length===expected.length&&rows.every(r=>r.covered),cashComplete=expected.length>0&&rows.length===expected.length&&rows.every(r=>numeric(r.officialCash)!==null),buyCoins=complete?sumKnown(rows,'buyCoins'):null,sellCoins=complete?sumKnown(rows,'sellCoins'):null,buyAmount=convertCoins(buyCoins,platform,'buy',policy),sellAmount=convertCoins(sellCoins,platform,'sell',policy),officialCash=cashComplete?sumKnown(rows,'officialCash'):null;
 return{complete,cashComplete,buyCoins,sellCoins,buyAmount,sellAmount,officialCash,scenarioRevenue:officialCash!==null&&buyAmount!==null&&sellAmount!==null?officialCash+buyAmount-sellAmount:null,officialRevenue:null,includeInActualRevenue:false};
}

export function parseArchiveOperatingSource(file,data,kind,{asOf=currentTaipeiDay(),platform='o8'}={}){
 const from=data?.from,through=data?.through??data?.to,capturedAt=data?.capturedAt??null,captureDate=day(capturedAt),p=data?.queryProof,header=data?.header,rows=data?.rows,issues=[],fields=kind==='active'?{dau:'DAU',loginEvents:'登入次數',onlineHours:'在線時數'}:{fortuneClaimEvents:'領取發財金次數',fortuneClaimCoins:'領取發財金總額',mobileVerificationEvents:'手機驗證',lineVerificationEvents:'加入官方Line帳號'};
 if(!exactUrl(data?.sourceUrl,'/statements/player-summary',platform)||data?.complete!==true||!validDate(from)||!validDate(through)||from>through||!captureDate||through>captureDate||captureDate>asOf)issues.push('operating_source_or_period_invalid');
 if(p?.verified!==true||p.selectedFrom!==from||p.selectedThrough!==through)issues.push('operating_dates_not_verified');
 const dateCol=Array.isArray(header)?header.indexOf('日期'):-1;if(dateCol<0||!Array.isArray(rows)||Object.values(fields).some(label=>!header.includes(label)))issues.push('operating_columns_missing');
 const entries=[],seen=new Set();if(!issues.length)for(const row of rows){const date=String(row[dateCol]??'').trim();if(!validDate(date))continue;if(seen.has(date)){issues.push('duplicate_operating_date');continue;}seen.add(date);if(date<from||date>through){issues.push('operating_row_outside_period');continue;}if(date>=captureDate||date>=asOf)continue;
  const values=Object.fromEntries(Object.entries(fields).map(([key,label])=>[key,parseBackendNumber(row[header.indexOf(label)])]));if(Object.values(values).some(v=>v!==null&&v<0)){issues.push('negative_operating_metric');continue;}
  entries.push({date,...values,source:{file,from,through,capturedAt,sourceUrl:data.sourceUrl,queryProof:structuredClone(p)}});
 }
 return{file,kind,from,through,capturedAt,sourceUrl:data?.sourceUrl??null,complete:issues.length===0,issues,entries:issues.length?[]:entries,header:Array.isArray(header)?structuredClone(header):[],rows:Array.isArray(rows)?structuredClone(rows):[]};
}

export function parseArchiveRegistration(file,data,{asOf=currentTaipeiDay(),platform='o8'}={}){
 const from=data?.period?.from,through=data?.period?.to,capturedAt=data?.capturedAt??null,captureDate=day(capturedAt),p=data?.queryProof,issues=[],value=parseBackendNumber(data?.newRegistered),all=data?.registrationTable?.find(r=>r[0]==='All');
 if(!exactUrl(data?.sourceUrl,'/statements/player-view',platform)||!validDate(from)||!validDate(through)||from>through||from.slice(8)!=='01'||from.slice(0,7)!==through.slice(0,7)||!captureDate||through>=captureDate||through>=asOf)issues.push('registration_source_or_closed_period_invalid');
 if(p?.verified!==true||p.selectedFrom!==from||p.selectedThrough!==through)issues.push('registration_dates_not_verified');
 if(value===null||!Number.isSafeInteger(value)||value<0||parseBackendNumber(all?.[1])!==value)issues.push('registration_total_not_reconciled');
 return{file,month:validDate(from)?from.slice(0,7):null,from,through,registration:issues.length?null:value,complete:issues.length===0,capturedAt,sourceUrl:data?.sourceUrl??null,queryProof:p?structuredClone(p):null,registrationTable:Array.isArray(data?.registrationTable)?structuredClone(data.registrationTable):[],issues,definition:'依創號日期區間統計新增帳號；同表其他儲值、贈禮、認證欄屬此cohort至擷取時累計，不是當月交易。'};
}

function monthRank(source,roster,roleIds,{platform,asOf}){
 const covered=roster.length>0&&!!source?.complete&&!source.partial&&source.captureDate<=asOf,ids=new Set(roster.map(r=>r.aid)),accounts=new Map(roster.map(r=>[r.aid,{aid:r.aid,nickname:r.nickname,externalOutCoins:covered?0:null,externalInCoins:covered?0:null,internalOutCoins:covered?0:null,internalInCoins:covered?0:null,excludedRoleOutCoins:covered?0:null,excludedRoleInCoins:covered?0:null,verified:false}]));for(const id of roleIds)ids.delete(id);
 if(covered)for(const e of source.edges.values()){
  if(e.fromAid===e.toAid)continue;const a=accounts.get(e.fromAid),b=accounts.get(e.toAid);
  if(roleIds.has(e.fromAid)||roleIds.has(e.toAid)){if(a)a.excludedRoleOutCoins+=e.coins;if(b)b.excludedRoleInCoins+=e.coins;continue;}
  if(ids.has(e.fromAid)&&ids.has(e.toAid)){a.internalOutCoins+=e.coins;b.internalInCoins+=e.coins;}else if(ids.has(e.fromAid))a.externalOutCoins+=e.coins;else if(ids.has(e.toAid))b.externalInCoins+=e.coins;
 }
 return{covered,platform,from:source?.from??null,through:source?.through??null,totalRows:source?.totalRows??null,sourceFiles:source?[source.file]:[],sourceUrl:source?.sourceUrl??null,capturedAt:source?.capturedAt??null,partial:source?.partial??null,queryProof:source?.queryProof??null,paginationProof:source?.paginationProof??null,validation:{...source?.validation,valid:covered,issues:[...(source?.issues??['month_rank_source_missing']),...(!roster.length?['scenario_roster_missing']:[])]},byMerchant:[...accounts.values()],buyCoins:covered?[...accounts.values()].reduce((s,r)=>s+r.externalOutCoins,0):null,sellCoins:covered?[...accounts.values()].reduce((s,r)=>s+r.externalInCoins,0):null};
}

function applyMonthlyRank(monthly,sources,roster,roleIds,{platform,policy,asOf}){
 const parsed=sources.map(r=>({...parseCompetitorFundingSource(r.file,r.data),queryProof:r.data.queryProof??null}));
 for(const m of monthly){
  const source=newest(parsed.filter(s=>s.platform===platform&&s.from===m.from&&s.through===m.through&&s.complete)),rank=monthRank(source,roster,roleIds,{platform,asOf}),dailyComplete=m.complete,dailySummary={buyCoins:m.buyCoins,sellCoins:m.sellCoins};
  m.dailyComplete=dailyComplete;m.dailyCoveredDays=m.coveredDays;m.dailyMissingDates=[...m.missingDates];m.monthScope={from:m.from,through:m.through,fullCalendarMonth:!m.partialMonth,partialMonth:m.partialMonth};m.monthRank=rank;
  m.reconciliation=rank.covered&&dailyComplete?{status:Math.abs(rank.buyCoins-dailySummary.buyCoins)<.01&&Math.abs(rank.sellCoins-dailySummary.sellCoins)<.01?'match':'mismatch',rankBuyCoins:rank.buyCoins,rankSellCoins:rank.sellCoins,dailyBuyCoins:dailySummary.buyCoins,dailySellCoins:dailySummary.sellCoins,definition:'月排行與同期間逐日歸檔獨立核對，不相加；差異保留來源採集時間供覆核。'}:{status:rank.covered?'monthly_only':dailyComplete?'daily_only':'unavailable'};
  if(rank.covered){m.directionSource='monthly_pair_ranking';m.sourceFiles=rank.sourceFiles;m.capturedAt=rank.capturedAt;m.complete=m.reconciliation.status!=='mismatch';m.buyCoins=m.complete?rank.buyCoins:null;m.sellCoins=m.complete?rank.sellCoins:null;m.buyAmount=convertCoins(m.buyCoins,platform,'buy',policy);m.sellAmount=convertCoins(m.sellCoins,platform,'sell',policy);m.scenarioRevenue=m.officialCash!==null&&m.buyAmount!==null&&m.sellAmount!==null?m.officialCash+m.buyAmount-m.sellAmount:null;
  }else m.directionSource=dailyComplete?'daily_archive':null;
  m.coverageStatus=m.reconciliation.status==='mismatch'?'source_mismatch':rank.covered&&!dailyComplete?'monthly_aggregate_available_daily_missing':dailyComplete?'complete_daily':'missing';
  m.knownDirectionCoverage=m.complete;m.missingDates=m.complete?[]:m.dailyMissingDates;
 }
 return parsed.filter(s=>!s.complete).map(s=>({file:s.file,from:s.from,through:s.through,capturedAt:s.capturedAt,issues:s.issues}));
}

export function analyzeCompetitorArchive(reports,{cashSources=[],giftSummaries=[],operatingSources=[],registrationSources=[],monthRankSources=[],policy={},asOf=currentTaipeiDay(),platform='o8',year=Number(asOf.slice(0,4)),fundingScenarios=null,schedule=null}={}){
 if(!SITES[platform]||!validDate(asOf)||!Number.isInteger(year))throw Error('Invalid archive calendar context');
 const through=shift(asOf,-1),from=String(year)+'-01-01',expected=dates(from,through),parsed=reports.map(r=>parseArchiveDailySource(r.file,r.data,{asOf,platform})),selected=new Map(),snapshotConflicts=[];
 for(const date of expected){let versions=parsed.filter(s=>s.date===date&&s.complete);while(versions.length){const candidate=newest([...versions]),sameCapture=versions.filter(s=>Date.parse(s.capturedAt)===Date.parse(candidate.capturedAt));if(new Set(sameCapture.map(s=>s.signature)).size>1){snapshotConflicts.push({date,capturedAt:candidate.capturedAt,sourceFiles:sameCapture.map(s=>s.file),issue:'same_capture_conflicting_directed_amounts'});versions=versions.filter(s=>!sameCapture.includes(s));continue;}selected.set(date,candidate);break;}}
 const model=fundingScenarios?.platforms?.find(p=>p.platform===platform),includedMerchants=structuredClone(model?.includedMerchants??COMPETITOR_SCENARIO_ROSTER[platform]??[]),excludedRoles=structuredClone(model?.excludedRoles??(platform==='o8'?fallbackRoles:[])),merchantIds=new Set(includedMerchants.map(m=>m.aid)),roleIds=new Set(excludedRoles.filter(r=>r.excludeFromScenario).map(r=>r.aid));for(const id of roleIds)merchantIds.delete(id);
 const cash=cashRows(cashSources,asOf,platform),daily=expected.map(date=>{
  const s=selected.get(date),c=cash.map.get(date);let buyCoins=null,sellCoins=null,excludedInternalCoins=null,excludedRoleCoins=null;
  if(s&&merchantIds.size){buyCoins=0;sellCoins=0;excludedInternalCoins=0;excludedRoleCoins=0;for(const e of s.edges.values()){if(e.fromAid===e.toAid)continue;if(roleIds.has(e.fromAid)||roleIds.has(e.toAid)){excludedRoleCoins+=e.coins;continue;}const a=merchantIds.has(e.fromAid),b=merchantIds.has(e.toAid);if(a&&b)excludedInternalCoins+=e.coins;else if(a)buyCoins+=e.coins;else if(b)sellCoins+=e.coins;}}
  const buyAmount=convertCoins(buyCoins,platform,'buy',policy),sellAmount=convertCoins(sellCoins,platform,'sell',policy),officialCash=c?.value??null;
  return{date,covered:!!s&&merchantIds.size>0,partial:false,buyCoins,sellCoins,buyAmount,sellAmount,officialCash,scenarioRevenue:officialCash!==null&&buyAmount!==null&&sellAmount!==null?officialCash+buyAmount-sellAmount:null,officialRevenue:null,includeInActualRevenue:false,excludedInternalCoins,excludedRoleCoins,capturedAt:s?.capturedAt??null,sourceFiles:s?[s.file]:[],source:dailyMeta(s),cashSource:c?{file:c.file,capturedAt:c.capturedAt,sourceUrl:c.sourceUrl,complete:true,queryProof:c.queryProof}:null};
 });
 const merchantCoverage=coverage(expected,daily.filter(r=>r.covered).map(r=>r.date)),cashCoverage=coverage(expected,[...cash.map.keys()]);
 const summaries=giftSummaries.map(r=>parseArchiveGiftSummary(r.file,r.data,{asOf,platform})),globalDaily=new Map(),globalMonthly=new Map();
 for(const s of summaries.filter(s=>s.complete))for(const [items,map,key] of [[s.daily,globalDaily,'date'],[s.monthly,globalMonthly,'month']])for(const row of items){const old=map.get(row[key]);if(!old||Date.parse(row.capturedAt)>Date.parse(old.capturedAt))map.set(row[key],row);}
 const monthly=merchantCoverage.months.map(m=>{const rows=daily.filter(r=>r.date.startsWith(m.month)),known=rows.filter(r=>r.covered),cashKnown=rows.filter(r=>numeric(r.officialCash)!==null),summary=summarize(rows,rows.map(r=>r.date),policy,platform),sourceFiles=[...new Set(known.flatMap(r=>r.sourceFiles))],cashSourceFiles=[...new Set(cashKnown.map(r=>r.cashSource.file).filter(Boolean))];return{month:m.month,from:rows[0]?.date??null,through:rows.at(-1)?.date??null,expectedDays:m.expectedDays,coveredDays:m.coveredDays,missingDates:m.missingDates,...summary,partialMonth:rows.at(-1)?.date!==new Date(Date.UTC(Number(m.month.slice(0,4)),Number(m.month.slice(5)),0)).toISOString().slice(0,10),cashCoveredDays:cashKnown.length,cashMissingDates:rows.filter(r=>r.officialCash===null).map(r=>r.date),sourceFiles,capturedAt:known.map(r=>r.capturedAt).filter(Boolean).sort().at(-1)??null,cashSourceFiles,cashCapturedAt:cashKnown.map(r=>r.cashSource.capturedAt).sort().at(-1)??null,observed:{coveredDays:known.length,buyCoins:sumKnown(known,'buyCoins'),sellCoins:sumKnown(known,'sellCoins'),cashCoveredDays:cashKnown.length,officialCash:sumKnown(cashKnown,'officialCash')}};});
 const rejectedMonthRanks=applyMonthlyRank(monthly,monthRankSources,includedMerchants,roleIds,{platform,policy,asOf});
 const operating=operatingSources.map(s=>parseArchiveOperatingSource(s.file,s.data,s.kind,{asOf,platform})),activeMap=new Map(),benefitMap=new Map();
 for(const s of operating.filter(s=>s.complete)){const map=s.kind==='active'?activeMap:benefitMap;for(const r of s.entries){const old=map.get(r.date);if(!old||Date.parse(r.source.capturedAt)>Date.parse(old.source.capturedAt))map.set(r.date,r);}}
 const operatingDaily=expected.map(date=>{const a=activeMap.get(date),b=benefitMap.get(date),c=cash.map.get(date);return{date,dau:a?.dau??null,loginEvents:a?.loginEvents??null,onlineHours:a?.onlineHours??null,fortuneClaimEvents:b?.fortuneClaimEvents??null,fortuneClaimCoins:b?.fortuneClaimCoins??null,mobileVerificationEvents:b?.mobileVerificationEvents??null,lineVerificationEvents:b?.lineVerificationEvents??null,officialCash:c?.value??null,activeSource:a?.source??null,benefitSource:b?.source??null,cashSource:c?{file:c.file,capturedAt:c.capturedAt,sourceUrl:c.sourceUrl}:null};});
 const operatingMonthly=merchantCoverage.months.map(m=>{const rows=operatingDaily.filter(r=>r.date.startsWith(m.month)),activeMissingDates=rows.filter(r=>['dau','loginEvents','onlineHours'].some(k=>r[k]===null)).map(r=>r.date),benefitKeys=['fortuneClaimEvents','fortuneClaimCoins','mobileVerificationEvents','lineVerificationEvents'],benefitMissingDates=rows.filter(r=>benefitKeys.some(k=>r[k]===null)).map(r=>r.date),cashMissingDates=rows.filter(r=>r.officialCash===null).map(r=>r.date),sources=[...new Map(rows.flatMap(r=>[r.activeSource,r.benefitSource,r.cashSource].filter(Boolean)).map(s=>[s.file+'|'+s.capturedAt,s])).values()],dauSum=sumKnown(rows,'dau');return{month:m.month,from:rows[0]?.date??null,through:rows.at(-1)?.date??null,expectedDays:rows.length,activeCoveredDays:rows.length-activeMissingDates.length,benefitCoveredDays:rows.length-benefitMissingDates.length,cashCoveredDays:rows.length-cashMissingDates.length,averageDAU:dauSum===null?null:dauSum/rows.length,...Object.fromEntries(['loginEvents','onlineHours',...benefitKeys,'officialCash'].map(k=>[k,sumKnown(rows,k)])),activeMissingDates,benefitMissingDates,cashMissingDates,sources,capturedAt:sources.map(s=>s.capturedAt).filter(Boolean).sort().at(-1)??null,definition:'DAU為每日去重人數之日平均；登入、時數、福利領取及驗證皆跨日事件加總，不是月去重會員。'};});
 const registrationMonths=registrationSources.map(r=>parseArchiveRegistration(r.file,r.data,{asOf,platform}));
 for(const m of operatingMonthly){const s=newest(registrationMonths.filter(r=>r.complete&&r.from===m.from&&r.through===m.through));m.registration=s?.registration??null;m.registrationPeriodComplete=!!s;m.registrationSource=s?{file:s.file,from:s.from,through:s.through,capturedAt:s.capturedAt,sourceUrl:s.sourceUrl,queryProof:s.queryProof,definition:s.definition}:null;}
 const recentFrom=shift(asOf,-7),recentDates=dates(recentFrom,through),recentRows=daily.filter(r=>r.date>=recentFrom&&r.date<=through),priorDates=dates(shift(recentFrom,-7),shift(recentFrom,-1)),priorRows=daily.filter(r=>priorDates.includes(r.date)),recentSummary=summarize(recentRows,recentDates,policy,platform),priorSummary=summarize(priorRows,priorDates,policy,platform),comparable=recentSummary.complete&&priorSummary.complete;
 const timestamps=[...new Set(recentRows.filter(r=>r.covered).map(r=>r.capturedAt))].sort(),sourceUpdatedAt=[...selected.values()].map(s=>s.capturedAt).sort().at(-1)??null;
 const recentWindow={from:recentFrom,through,expectedDays:recentDates.length,coveredDays:recentRows.filter(r=>r.covered).length,complete:recentSummary.complete,missingDates:recentDates.filter(d=>!recentRows.some(r=>r.date===d&&r.covered)),mixedCapture:timestamps.length>1,capturedFrom:timestamps[0]??null,capturedThrough:timestamps.at(-1)??null,summary:recentSummary,comparison:{comparable,from:priorDates[0],through:priorDates.at(-1),previousSummary:priorSummary,reason:comparable?'兩個七日區間的同一候選口徑完整':'上期或本期七個已結日來源不完整，不外推前期、不計增減幅度',buyAmountDelta:comparable&&recentSummary.buyAmount!==null&&priorSummary.buyAmount!==null?recentSummary.buyAmount-priorSummary.buyAmount:null,sellAmountDelta:comparable&&recentSummary.sellAmount!==null&&priorSummary.sellAmount!==null?recentSummary.sellAmount-priorSummary.sellAmount:null}};
 const enrichment={};for(const key of ['cash','globalGift']){const value=schedule?.enrichment?.[key];if(value&&typeof value==='object')enrichment[key]={ok:value.ok===true?true:value.ok===false?false:null,from:validDate(value.from)?value.from:null,through:validDate(value.through)?value.through:null,capturedAt:typeof value.capturedAt==='string'&&Number.isFinite(Date.parse(value.capturedAt))?value.capturedAt:null,error:typeof value.error==='string'&&/^[a-z0-9_]{1,80}$/.test(value.error)?value.error:value.error==null?null:'report_failed'};}
 const statuses=new Set(['not_configured','configured_unverified','success','failed','login_required']),scheduleData={time:'08:00',timezone:'Asia/Taipei',configured:schedule?.configured===true,status:statuses.has(schedule?.status)?schedule.status:schedule?.configured===true?'configured_unverified':'not_configured',partial:schedule?.partial===true,enrichment,monthlyRanks:safeMonthlyRankStatus(schedule?.monthlyRanks,platform),lastSuccessfulCaptureAt:schedule?.lastSuccessfulCaptureAt??null,lastSuccessfulRunAt:typeof schedule?.lastSuccessfulRunAt==='string'&&Number.isFinite(Date.parse(schedule.lastSuccessfulRunAt))?schedule.lastSuccessfulRunAt:null,lastAttemptAt:schedule?.lastAttemptAt??null,failureAt:schedule?.failureAt??null,error:schedule?.error??null,loginExpired:schedule?.loginExpired??null,sourceUpdatedAt,definition:`每天08:00歸檔當時權限可回溯的${platform==='o8'?'六':'七'}個已結日，另核對同期官儲與全站收贈日報；歷史已保存日期繼續保留，不因新窗口移動而遺失。`};
 return{schema:1,platform,name:SITES[platform].name,identityStatus:includedMerchants.length?'unconfirmed_network_candidate':'missing_roster',rates:{buyDivisor:policy?.rates?.[platform]?.buyDivisor??null,sellDivisor:policy?.rates?.[platform]?.sellDivisor??null},modelVersion:COMPETITOR_SCENARIO_MODEL_VERSION,asOf,timezone:'Asia/Taipei',includedMerchants,excludedRoles,recentWindow,daily,monthly,coverage:{from,through,merchant:merchantCoverage,cash:cashCoverage,activity:coverage(expected,operatingDaily.filter(r=>r.dau!==null&&r.loginEvents!==null&&r.onlineHours!==null).map(r=>r.date)),benefits:coverage(expected,operatingDaily.filter(r=>r.fortuneClaimEvents!==null&&r.fortuneClaimCoins!==null&&r.mobileVerificationEvents!==null&&r.lineVerificationEvents!==null).map(r=>r.date)),globalGift:{daily:coverage(expected,[...globalDaily.values()].filter(r=>r.complete).map(r=>r.date)),monthly:{availableMonths:[...globalMonthly.keys()].sort(),coveredMonths:[...globalMonthly.values()].filter(r=>r.complete).map(r=>r.month).sort(),missingMonths:merchantCoverage.months.map(m=>m.month).filter(m=>!globalMonthly.get(m)?.complete)}}},history:{operatingDaily,operatingMonthly,registrationMonths:registrationMonths.map(compactSource),operatingSources:operating.map(s=>compactSource({file:s.file,kind:s.kind,from:s.from,through:s.through,capturedAt:s.capturedAt,sourceUrl:s.sourceUrl,complete:s.complete,issues:s.issues,header:s.header,rows:s.rows})),daily:[...globalDaily.values()].sort((a,b)=>a.date.localeCompare(b.date)),monthly:[...globalMonthly.values()].sort((a,b)=>a.month.localeCompare(b.month)),sources:summaries.map(s=>compactSource({file:s.file,from:s.from,through:s.through,capturedAt:s.capturedAt,sourceUrl:s.sourceUrl,complete:s.complete,issues:s.issues,...s.raw})),definition:'全站新贈禮總金額、手續費及人次／筆數；不是指定候選買賣量、成交現金或實際營收。'},schedule:scheduleData,snapshotConflicts,rejectedMonthRanks,rejectedSources:parsed.filter(s=>!s.complete).map(s=>({file:s.file,date:s.date,capturedAt:s.capturedAt,issues:s.issues})),rejectedCashSources:cash.rejected,officialRevenue:null,includeInActualRevenue:false,definitions:{identity:'固定本站原交易網路候選作情境，未確認幣商身分；使用者確認的主播角色派發另排除，不擴張至其他平台。',archive:'每個日期只採最新可驗證完整已結日；flat、immutable版本及重疊週檔不重複相加。',zero:'無完整來源為null；完整排行中未見候選邊才可為0。',conversion:'本站買賣原幣依指定除數換算；未核實實際成交現金及歷史生效日，非正式營收。',history:'全站收贈禮彙總與指定候選方向分區；不由全站總額反推買賣方向。'}};
}

async function json(file){return JSON.parse((await fs.readFile(file,'utf8')).replace(/^\uFEFF/,''));}
async function boundedFiles(directory,depth=0){if(depth>4)return[];let entries;try{entries=await fs.readdir(directory,{withFileTypes:true});}catch(e){if(e.code==='ENOENT')return[];throw e;}const out=[];for(const e of entries){const file=path.join(directory,e.name);if(e.isDirectory())out.push(...await boundedFiles(file,depth+1));else if(e.isFile()&&e.name.endsWith('.json')&&e.name!=='index.json')out.push(file);}return out;}
export async function buildCompetitorArchive(liveDir,{platform='o8',policy=null,competitors=null,...options}={}){
 if(!SITES[platform])throw Error('Unsupported competitor archive platform');
 const names=await fs.readdir(liveDir),reports=[],cashSources=[],giftSummaries=[],operatingSources=[],registrationSources=[],monthRankSources=[],sourceReadErrors=[],starts=prefix=>names.filter(f=>f.startsWith(prefix+platform+'-')&&f.endsWith('.json'));
 const dailyFiles=[...starts('gift-daily-rank-').map(f=>path.join(liveDir,f)),...await boundedFiles(path.join(liveDir,`competitor-archive/${platform}/daily`)),...await boundedFiles(path.join(liveDir,`competitor-archive/${platform}/captures`))];
 for(const file of dailyFiles)try{reports.push({file:path.relative(liveDir,file).replaceAll('\\','/'),data:await json(file)});}catch{sourceReadErrors.push({file:path.relative(liveDir,file),issue:'daily_json_unreadable'});}
 for(const file of starts('competitor-cash-range-'))try{cashSources.push(parseCompetitorCashSource(file,await json(path.join(liveDir,file))));}catch{sourceReadErrors.push({file,issue:'cash_json_unreadable'});}
 for(const file of starts('competitor-period-rank-'))try{monthRankSources.push({file,data:await json(path.join(liveDir,file))});}catch{sourceReadErrors.push({file,issue:'month_rank_json_unreadable'});}
 if(competitors===null)try{const raw=await json(path.join(liveDir,'competitor-observations.json'));competitors=Array.isArray(raw)?raw:raw.competitors??[];}catch(e){if(e.code!=='ENOENT')throw e;competitors=[];}
 const c=competitors?.find(c=>c.key===platform);if(c?.consumeDaily)cashSources.push({file:'competitor-observations.json',rows:normalizeDaily(c.consumeDaily),capturedAt:c.consumeDaily.capturedAt??c.capturedAt,sourceUrl:c.consumeDaily.sourceUrl??c.url+'statements/player-summary'});
 for(const file of starts('competitor-gift-summary-'))try{const raw=await json(path.join(liveDir,file));if(raw.daily||raw.monthly)for(const key of ['daily','monthly']){if(raw[key])giftSummaries.push({file:file+'#'+key,data:{...raw,...raw[key],daily:undefined,monthly:undefined}});}else giftSummaries.push({file,data:raw});}catch{sourceReadErrors.push({file,issue:'gift_summary_json_unreadable'});}
 for(const file of starts('competitor-summary-history-'))try{const raw=await json(path.join(liveDir,file));for(const [key,kind] of [['activeDaily','active'],['otherDaily','benefits']])if(raw[key])operatingSources.push({file:file+'#'+key,kind,data:raw[key]});}catch{sourceReadErrors.push({file,issue:'operating_history_json_unreadable'});}
 for(const file of starts('competitor-registrations-monthly-'))try{const raw=await json(path.join(liveDir,file));if(raw.platform===platform)for(const doc of raw.monthly??[])registrationSources.push({file:file+'#'+doc.period?.from,data:doc});}catch{sourceReadErrors.push({file,issue:'registration_history_json_unreadable'});}
 let schedule=null;const statusFile=`competitor-archive/${platform}/status.json`;try{schedule=await json(path.join(liveDir,statusFile));}catch(e){if(e.code!=='ENOENT')sourceReadErrors.push({file:statusFile,issue:'schedule_json_unreadable'});}
 return{...analyzeCompetitorArchive(reports,{...options,platform,policy:policy??await loadCoinConversionPolicy(),cashSources,giftSummaries,operatingSources,registrationSources,monthRankSources,schedule}),sourceReadErrors};
}

export async function buildCompetitorArchives(liveDir,{policy=null,platforms=Object.keys(SITES),...options}={}){
 const conversion=policy??await loadCoinConversionPolicy();
 return{schema:1,platforms:await Promise.all(platforms.map(platform=>buildCompetitorArchive(liveDir,{...options,platform,policy:conversion})))};
}
