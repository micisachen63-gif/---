import fs from 'node:fs/promises';
import path from 'node:path';

export const DAILY_COLUMNS = ['date','dau','dpu','transactions','deposit','payRatePercent','arpu','arppu','firstPayers','firstCash'];
const DAILY_HEADERS = [['日期'],['DAU'],['DPU'],['總筆數','儲值筆數'],['總金額','儲值金額'],['儲值率'],['ARPU'],['ARPPU'],['首儲人數'],['首儲總額']];
const COMPETITOR_NAMES = {o8:'發又發',aos:'黑桃A',fcc:'財哥',cgb:'超吉爆',goldfun:'金來快',o9:'黑狗兄'};
const PLATFORM_ALIASES = {lylucky:'lucky',lybobet:'bo'};

export function parseBackendNumber(value) {
 if (value == null || typeof value === 'boolean') return null;
 if (typeof value === 'number') return Number.isFinite(value) ? value : null;
 const text = String(value).trim().replaceAll(',','').replace(/[％%]$/,'');
 if (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/.test(text)) return null;
 const n = Number(text); return Number.isFinite(n) ? n : null;
}
const key = value => String(value ?? '').replace(/\s+/g,'').toUpperCase();
function table(value) {
 if (!value) return {header:[],rows:[]};
 if (Array.isArray(value)) return {header:value[0] ?? [],rows:value.slice(1)};
 return {header:value.header ?? value.rows?.[0] ?? [],rows:value.header ? value.rows ?? [] : value.rows?.slice(1) ?? []};
}
function column(header,names) {return header.findIndex(h=>names.some(n=>key(h)===key(n)));}
function field(header,row,names) {const i=column(header,names);return i<0 ? null : parseBackendNumber(row[i]);}
const ratio = value => {const n=parseBackendNumber(value);return n===null?null:n/100;};
const datePattern = /^\d{4}-\d{2}-\d{2}$/;
const monthPattern = /^\d{4}-\d{2}$/;
function taipeiDate(value) {
 if(!value || !Number.isFinite(Date.parse(value))) return null;
 return new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Taipei',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(value));
}
export function currentTaipeiDay(now=new Date()){return taipeiDate(now.toISOString());}
function monthEnd(month) {return month+'-'+String(new Date(Number(month.slice(0,4)),Number(month.slice(5)),0).getDate()).padStart(2,'0');}
function uniqueRows(rows,label) {
 const map=new Map();
 for(const row of rows) {if(map.has(row[0])) throw Error(label+' duplicate date: '+row[0]);map.set(row[0],row);}
 return [...map.values()].sort((a,b)=>a[0].localeCompare(b[0]));
}

export function normalizeDaily(snapshot) {
 const {header,rows}=table(snapshot);
 if(column(header,['日期'])<0) return [];
 const dateIndex=column(header,['日期']);
 return uniqueRows(rows.filter(r=>datePattern.test(String(r[dateIndex]))).map(row=>DAILY_HEADERS.map((names,i)=>i===0?String(row[dateIndex]):field(header,row,names))),'daily');
}

export function splitTodayProgress(rows,metadata={},today=currentTaipeiDay()) {
 // A snapshot taken during a date stays partial after midnight. Only a later
 // capture can prove that date closed; the build clock cannot promote it.
 const sourceRows=uniqueRows(rows,'daily'),captureDate=taipeiDate(metadata.capturedAt);
 const daily=sourceRows.filter(row=>captureDate!==null&&row[0]<captureDate&&row[0]<today);
 let found=sourceRows.find(row=>row[0]===today),explicit=metadata.dailyToday;
 let capturedAt=metadata.capturedAt??null,sourceUrl=metadata.sourceUrl??null;
 if(explicit){
  let matched=false;
  if(Array.isArray(explicit)&&explicit[0]===today){found=explicit;matched=true;}
  else if(explicit.header||Array.isArray(explicit.rows)){const r=normalizeDaily(explicit).find(r=>r[0]===today);if(r){found=r;matched=true;}}
  else if(explicit.date===today){found=[today,explicit.dau,explicit.dpu,explicit.transactions,explicit.todayCash??explicit.deposit,null,null,null,explicit.firstPayers,explicit.firstCash];matched=true;}
  if(matched){capturedAt=explicit.capturedAt??capturedAt;sourceUrl=explicit.sourceUrl??sourceUrl;}
 }
 const todayProgress=found&&taipeiDate(capturedAt)===today?{platform:metadata.platform,date:today,todayCash:parseBackendNumber(found[4]),dau:parseBackendNumber(found[1]),dpu:parseBackendNumber(found[2]),transactions:parseBackendNumber(found[3]),firstPayers:parseBackendNumber(found[8]),firstCash:parseBackendNumber(found[9]),capturedAt,sourceUrl,partial:true}:null;
 return {daily,todayProgress,coverage:{captureDate,captureTimeKnown:captureDate!==null,excludedUnclosedDates:sourceRows.filter(row=>row[0]<today&&!daily.includes(row)).map(row=>row[0]),definition:'完整日須早於來源採集的台灣日期及目前日期；舊的當日未結列不因跨日或重建而升為完整。'}};
}

export function normalizeMonthly(platform,consume,active,metadata={}) {
 const c=table(consume),a=table(active),map=new Map();
 for(const [source,kind] of [[a,'active'],[c,'consume']]) {
  const index=column(source.header,['日期']);if(index<0)continue;
  const seen=new Set();
  for(const row of source.rows) {
   const month=String(row[index] ?? '');if(!monthPattern.test(month))continue;
   if(seen.has(month))throw Error(kind+' duplicate month: '+month);seen.add(month);
   const sourceMeta=kind==='consume'?consume:active;
   const capturedAt=sourceMeta?.capturedAt ?? metadata.capturedAt ?? null;
   const captureDate=taipeiDate(capturedAt),end=monthEnd(month);
   const partial=captureDate!==null && captureDate<=end;
   const through=partial ? (captureDate.startsWith(month)?captureDate:null) : captureDate ? end : null;
   const item=map.get(month) ?? {platform,month,mau:null,mpu:null,deposit:null,payRate:null,arpu:null,arppu:null,firstPayers:null,firstCash:null,capturedAt,through,partial:captureDate===null?null:partial,sourceUrl:sourceMeta?.sourceUrl ?? metadata.sourceUrl ?? null};
   if(kind==='active') item.mau=field(source.header,row,['MAU']);
   else {
    Object.assign(item,{mau:field(source.header,row,['MAU']) ?? item.mau,mpu:field(source.header,row,['MPU']),deposit:field(source.header,row,['總金額','儲值金額']),payRate:ratio(row[column(source.header,['儲值率'])]),arpu:field(source.header,row,['ARPU']),arppu:field(source.header,row,['ARPPU']),firstPayers:field(source.header,row,['首儲人數']),firstCash:field(source.header,row,['首儲總額']),transactions:field(source.header,row,['總筆數','儲值筆數']),capturedAt,through,partial:captureDate===null?null:partial,sourceUrl:sourceMeta?.sourceUrl ?? metadata.sourceUrl ?? null});
   }
   map.set(month,item);
  }
 }
 return [...map.values()].sort((a,b)=>a.month.localeCompare(b.month));
}

function sum(rows,index) {return rows.length && rows.every(r=>r[index]!==null) ? rows.reduce((s,r)=>s+r[index],0) : null;}
function divide(a,b) {return a!==null && b!==null && b!==0 ? a/b : null;}
function expectedDays(from,to) {
 if(!datePattern.test(from??'') || !datePattern.test(to??'') || from>to) return [];
 const result=[];for(let time=Date.parse(from+'T00:00:00Z');time<=Date.parse(to+'T00:00:00Z');time+=86400000)result.push(new Date(time).toISOString().slice(0,10));return result;
}
export function periodMetrics(daily,from,to,extras={}) {
 const rows=daily.filter(r=>r[0]>=from && r[0]<=to),expected=expectedDays(from,to),present=new Set(rows.map(r=>r[0]));
 const missingDates=expected.filter(d=>!present.has(d)),cash=sum(rows,4),activeDays=sum(rows,1),payerDays=sum(rows,2);
 return {from,to,days:rows.length,expectedDays:expected.length,complete:expected.length>0 && missingDates.length===0,missingDates,cash,deposit:cash,dau:divide(activeDays,rows.length),averageDAU:divide(activeDays,rows.length),dpu:divide(payerDays,rows.length),averageDPU:divide(payerDays,rows.length),payerDays,transactions:sum(rows,3),depositTransactionCount:sum(rows,3),payRate:divide(payerDays,activeDays),arpu:divide(cash,activeDays),arppu:divide(cash,payerDays),firstPayers:sum(rows,8),firstCash:sum(rows,9),firstDepositAmount:sum(rows,9),newRegistered:parseBackendNumber(extras.newRegistered),gameBetCount:parseBackendNumber(extras.gameBetCount),gameTotalBet:parseBackendNumber(extras.gameTotalBet),gamePayout:parseBackendNumber(extras.gamePayout),gameNet:parseBackendNumber(extras.gameNet),gameRTPPercent:parseBackendNumber(extras.gameRTPPercent),note:'ARPU/ARPPU/付費率以每日活躍及付費人次加權，不是區間去重會員口徑；遊戲金額是原遊戲點數，非現金淨營收。'};
}
function changes(prev,current) {
 const comparable=prev.complete && current.complete && prev.days===current.days;
 const fields=['cash','deposit','dau','averageDAU','dpu','averageDPU','transactions','firstPayers','firstCash','newRegistered','gameBetCount','gameTotalBet','gamePayout','gameNet'];
 const out={comparable,previousPeriod:{from:prev.from,to:prev.to},currentPeriod:{from:current.from,to:current.to}};
 for(const name of fields) {out[name]=comparable && prev[name]!==null && current[name]!==null ? current[name]-prev[name] : null;out[name+'Rate']=comparable ? (divide(current[name],prev[name])===null?null:current[name]/prev[name]-1) : null;}
 out.payRatePoints=comparable && prev.payRate!==null && current.payRate!==null ? (current.payRate-prev.payRate)*100 : null;
 out.rtpPoints=comparable && prev.gameRTPPercent!==null && current.gameRTPPercent!==null?current.gameRTPPercent-prev.gameRTPPercent:null;
 return out;
}
function yearCharts(monthly) {
 return [...new Set(monthly.map(m=>m.month.slice(0,4)))].map(year=>({year,months:Array.from({length:12},(_,i)=>{const month=year+'-'+String(i+1).padStart(2,'0');return monthly.find(m=>m.month===month) ?? {month,mau:null,mpu:null,deposit:null,payRate:null,arpu:null,arppu:null,firstPayers:null,firstCash:null,through:null,partial:null};})}));
}

const DEFAULT_COMPARISON={previousFrom:'2026-09-01',previousThrough:'2026-09-19',currentFrom:'2026-10-01',currentThrough:'2026-10-19'};
function comparisonSource(source,from,through,kind,strict){
 const actualFrom=source?.period?.from??source?.from,actualThrough=source?.period?.through??source?.period?.to??source?.through??source?.to,captureDate=taipeiDate(source?.capturedAt),proof=source?.queryProof,issues=[];
 if(actualFrom!==from||actualThrough!==through)issues.push('source_period_mismatch');
 if(!captureDate||through>=captureDate)issues.push('source_not_closed_at_capture');
 if(strict&&(proof?.verified!==true||proof.selectedFrom!==from||proof.selectedThrough!==through))issues.push('selected_dates_not_verified');
 return{kind,from:actualFrom??null,through:actualThrough??null,capturedAt:source?.capturedAt??null,sourceUrl:source?.sourceUrl??null,valid:issues.length===0,issues};
}
function comparisonExtras(raw,from,through,side,strict){
 const registration=raw.newRegistrations?.[side],game=raw.gameSummaries?.[side],registrationEvidence=comparisonSource(registration,from,through,'registration',strict),gameEvidence=comparisonSource(game,from,through,'game',strict),summary=game?.summary;
 const extras={newRegistered:registrationEvidence.valid?parseBackendNumber(registration?.newRegistered):null};
 for(const [name,index] of [['gameBetCount',1],['gameTotalBet',2],['gamePayout',4],['gameNet',5],['gameRTPPercent',6]])extras[name]=gameEvidence.valid&&Array.isArray(summary)?parseBackendNumber(summary[index]):null;
 if(extras.newRegistered===null)registrationEvidence.issues.push('registration_value_missing');
 if(Object.keys(extras).filter(k=>k.startsWith('game')).some(k=>extras[k]===null))gameEvidence.issues.push('game_summary_values_missing');
 registrationEvidence.valid=registrationEvidence.issues.length===0;gameEvidence.valid=gameEvidence.issues.length===0;
 return{extras,evidence:{registration:registrationEvidence,game:gameEvidence},ready:registrationEvidence.valid&&gameEvidence.valid};
}

export function normalizeCompetitor(raw,{today=currentTaipeiDay()}={}) {
 const split=splitTodayProgress(normalizeDaily(raw.consumeDaily),{platform:raw.key,dailyToday:raw.dailyToday,capturedAt:raw.consumeDaily?.capturedAt??raw.capturedAt,sourceUrl:raw.consumeDaily?.sourceUrl??raw.sourceUrl??raw.url},today);
 const normalizedDaily=split.daily,normalizedMonthly=normalizeMonthly(raw.key,raw.consumeMonthly,raw.activeMonthly,raw);
 const explicit=(raw.key==='o8'||raw.comparisonPolicy==='exact-source-verified')&&raw.comparison!=null,requested=explicit?raw.comparison:DEFAULT_COMPARISON,comparison={...DEFAULT_COMPARISON,...requested},previousDates=expectedDays(comparison.previousFrom,comparison.previousThrough),currentDates=expectedDays(comparison.currentFrom,comparison.currentThrough),periodValid=previousDates.length>0&&previousDates.length===currentDates.length&&comparison.previousThrough<comparison.currentFrom&&comparison.currentThrough<today;
 const pExtra=explicit?comparisonExtras(raw,comparison.previousFrom,comparison.previousThrough,'sep',true):null,cExtra=explicit?comparisonExtras(raw,comparison.currentFrom,comparison.currentThrough,'oct',true):null;
 const prev=periodMetrics(normalizedDaily,comparison.previousFrom,comparison.previousThrough,pExtra?.extras??raw.metrics?.september1to19??{}),current=periodMetrics(normalizedDaily,comparison.currentFrom,comparison.currentThrough,cExtra?.extras??raw.metrics?.october1to19??{}),comparisonReady=periodValid&&prev.complete&&current.complete&&(!explicit||pExtra.ready&&cExtra.ready),change=changes({...prev,complete:prev.complete&&comparisonReady},{...current,complete:current.complete&&comparisonReady});
 const expected=expectedDays(comparison.previousFrom,comparison.currentThrough),present=new Set(normalizedDaily.map(r=>r[0]));
 const normalizedComparison={...comparison,days:currentDates.length,ready:comparisonReady,explicit,sourcePeriodsValid:!explicit||pExtra.ready&&cExtra.ready,sources:explicit?{previous:pExtra.evidence,current:cExtra.evidence}:null,issues:[...(!periodValid?['invalid_comparison_periods']:[]),...(!prev.complete||!current.complete?['cash_daily_dates_missing']:[]),...(explicit&&(!pExtra.ready||!cExtra.ready)?['registration_or_game_period_not_verified']:[])]};
 return {...raw,name:COMPETITOR_NAMES[raw.key] ?? raw.name,normalizedDaily,todayProgress:split.todayProgress,dailyClosureCoverage:split.coverage,normalizedDailyColumns:DAILY_COLUMNS,normalizedMonthly,normalizedComparison,normalizedMetrics:{prev,current,change},yearCharts:yearCharts(normalizedMonthly),validation:{dailyRows:normalizedDaily.length,expectedDailyRows:expected.length,completeDailyRange:expected.every(d=>present.has(d)),missingDates:expected.filter(d=>!present.has(d)),comparisonComplete:comparisonReady},normalizationNotes:['raw metrics、各表header/rows及遊戲units全部保留。','normalizedDaily[5]為百分點；normalizedMonthly與normalizedMetrics.payRate為0–1比例。','normalizedDaily只含早於來源採集台灣日及目前日期的完整日；舊未結列不因跨日升級，今日進度另存todayProgress。','明確設定新同期時，註冊與遊戲各自日期、採集時間及選取證據均須吻合，否則不宣稱完整同期。','未知資料使用null；缺日不補零，缺月份的年度圖表使用null。']};
}

async function readOptional(file) {try{return JSON.parse((await fs.readFile(file,'utf8')).replace(/^\uFEFF/,''));}catch(error){if(error.code==='ENOENT')return null;throw error;}}
export async function buildBackendMetrics(live) {
 const files=(await fs.readdir(live)).filter(name=>/^backend-history-[a-z]+\.json$/.test(name)).sort(),monthSnapshots=[];
 for(const file of files) {
  const raw=await readOptional(path.join(live,file));if(!raw)continue;
  const rawPlatform=file.match(/^backend-history-([a-z]+)\.json$/)[1],platform=PLATFORM_ALIASES[rawPlatform] ?? rawPlatform;
  monthSnapshots.push(...normalizeMonthly(platform,raw.consumeMonthly ?? raw.tables?.consumeMonthly,raw.activeMonthly ?? raw.tables?.activeMonthly,raw));
 }
 const observations=await readOptional(path.join(live,'competitor-observations.json'));
 const rawCompetitors=Array.isArray(observations)?observations:observations?.competitors ?? [];
 return {monthSnapshots:monthSnapshots.sort((a,b)=>a.platform.localeCompare(b.platform)||a.month.localeCompare(b.month)),competitors:rawCompetitors.map(normalizeCompetitor),definitions:{payRate:'月快照與normalizedMetrics為0–1；normalizedDaily第5索引為百分點。',monthlyCutoff:'未結月through依該表capturedAt台灣日期；可能包含當天未完整日，不能與前月完整月當同進度比較。',sources:'只讀後台報表；不讀週報作呈現數據。'}};
}
