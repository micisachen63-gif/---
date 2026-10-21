import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {parseBackendNumber} from './backend-metrics.mjs';

const ROOT=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const DEFAULT_LIVE='C:/Users/User/Documents/ChatGPT/outputs/01a15831-ccf2-7fc3-bbe2-813c2cd1dc71/live-data';
const OWN=['win','qz','song','rd','lucky','bo'],COMP=['o8','aos','fcc','cgb'];
const validDate=d=>/^\d{4}-\d{2}-\d{2}$/.test(String(d??''))&&Number.isFinite(Date.parse(d))&&new Date(d).toISOString().slice(0,10)===d;
const validMonth=m=>typeof m==='string'&&validDate(m+'-01');
const captureDay=t=>t&&Number.isFinite(Date.parse(t))?new Date(Date.parse(t)+8*3600000).toISOString().slice(0,10):null;
const endOfMonth=m=>new Date(Date.UTC(Number(m.slice(0,4)),Number(m.slice(5)),0)).toISOString().slice(0,10);
const priorDay=d=>new Date(Date.parse(d)-86400000).toISOString().slice(0,10);
export function qualityDates(from,to){const out=[];if(!validDate(from)||!validDate(to)||from>to)return out;for(let t=Date.parse(from);t<=Date.parse(to);t+=86400000)out.push(new Date(t).toISOString().slice(0,10));return out;}
const table=d=>{const explicit=Array.isArray(d?.header),all=Array.isArray(d?.rows)?d.rows:[],header=explicit?d.header:Array.isArray(all[0])?all[0]:[];return{header,rows:(explicit?all:all.slice(1)).filter(Array.isArray)};};
const issue=(code,severity='error',details={})=>({code,severity,...details});
const safeUrl=value=>{try{const u=new URL(value);return ['http:','https:'].includes(u.protocol)?u.origin+u.pathname:null;}catch{return null;}};
const money=value=>{if(typeof value==='number')return Number.isFinite(value)&&value>=0?value:null;const t=String(value??'').trim();return /^(?:\d+|\d{1,3}(?:,\d{3})+)(?:\.\d+)?$/.test(t)?parseBackendNumber(t):null;};
const source=(file,d)=>({file,capturedAt:captureDay(d?.capturedAt)?d.capturedAt:null,captureTaipei:captureDay(d?.capturedAt),sourceUrl:safeUrl(d?.sourceUrl),complete:typeof d?.complete==='boolean'?d.complete:null});
function dailyReference(raw,fallback=[]){
 const t=raw?.consumeDaily??raw?.tables?.consumeDaily;let rows=[],kind='missing',headerMissing=false;
 if(t){const {header,rows:r}=Array.isArray(t)?{header:t[0]??[],rows:t.slice(1)}:table(t),di=header.indexOf('日期'),ci=header.findIndex(h=>['總金額','儲值金額'].includes(h));headerMissing=di<0||ci<0;if(!headerMissing){rows=r.filter(row=>/^\d{4}-\d{2}-\d{2}$/.test(String(row[di]))).map(row=>({date:String(row[di]),cash:parseBackendNumber(row[ci])}));kind='consumeDaily';}}
 if(!rows.length){const r=Array.isArray(raw?.daily)?raw.daily:fallback;rows=r.map(row=>({date:row?.[0],cash:parseBackendNumber(row?.[4])}));kind=r.length?(raw?.daily?'normalized_backend_daily':'provided_D.daily'):'missing';}
 const capturedAt=t?.capturedAt??raw?.capturedAt??null;
 return{rows,kind,headerMissing,sourceComplete:typeof t?.complete==='boolean'?t.complete:typeof raw?.complete==='boolean'?raw.complete:null,capturedAt:captureDay(capturedAt)?capturedAt:null,sourceUrl:safeUrl(t?.sourceUrl??raw?.sourceUrl)};
}
function inspectDaily(platform,reference,{today,year,launchDates}){
 const yearStart=year+'-01-01',launch=launchDates[platform],start=launch&&launch>yearStart?launch:yearStart,expected=qualityDates(start,priorDay(today)),seen=new Set(),duplicates=[],invalid=[],unknownCash=[];
 for(const r of reference.rows){if(!validDate(r.date)){invalid.push(String(r.date).slice(0,10));continue;}if(seen.has(r.date))duplicates.push(r.date);seen.add(r.date);if(r.cash===null)unknownCash.push(r.date);}
 const missing=expected.filter(d=>!seen.has(d)),issues=[];
 if(duplicates.length)issues.push(issue('duplicate_daily_dates','error',{dates:[...new Set(duplicates)]}));if(invalid.length)issues.push(issue('invalid_daily_dates','error',{count:invalid.length}));if(missing.length)issues.push(issue('missing_completed_daily_dates','warning',{count:missing.length}));if(unknownCash.length)issues.push(issue('unknown_daily_cash','warning',{dates:unknownCash}));if(reference.headerMissing)issues.push(issue('daily_header_missing','warning'));if(reference.sourceComplete===false)issues.push(issue('daily_source_incomplete','warning'));
 const todayRows=reference.rows.filter(r=>r.date===today);if(todayRows.length)issues.push(issue('today_is_partial','info',{date:today}));
 return{platform,sourceKind:reference.kind,sourceComplete:reference.sourceComplete,capturedAt:reference.capturedAt,sourceUrl:reference.sourceUrl,expectedFrom:start,completeThrough:priorDay(today),availableFrom:[...seen].sort()[0]??null,availableThrough:[...seen].sort().at(-1)??null,observedDateCount:seen.size,expectedCompletedDates:expected.length,missingCompletedDates:missing,duplicateDates:[...new Set(duplicates)],unknownCashDates:unknownCash,today:{date:today,rows:todayRows.length,partial:true,available:todayRows.length>0},preLaunch:start>yearStart?{from:yearStart,through:priorDay(start),status:'not_launched'}:null,issues};
}
function periodCash(reference,from,through,launchDate){
 const effectiveFrom=launchDate&&launchDate>from?launchDate:from,expected=qualityDates(effectiveFrom,through),map=new Map(),duplicates=[];
 for(const r of reference.rows){if(r.date<effectiveFrom||r.date>through)continue;if(map.has(r.date))duplicates.push(r.date);map.set(r.date,r.cash);}
 const missing=expected.filter(d=>!map.has(d)),unknown=expected.filter(d=>map.has(d)&&map.get(d)===null),complete=reference.sourceComplete!==false&&expected.length>0&&!missing.length&&!unknown.length&&!duplicates.length;
 return{from,through,effectiveFrom,expectedDays:expected.length,observedDays:map.size,missingDates:missing,unknownCashDates:unknown,duplicateDates:[...new Set(duplicates)],complete,cash:complete?expected.reduce((sum,d)=>sum+map.get(d),0):null};
}
export function inspectRanking(file,d,reference,context){
 const documentValid=d&&typeof d==='object'&&!Array.isArray(d);if(!documentValid)d={};
 const match=/^deposit-ranking-(win|qz|song|rd|lucky|bo)-(\d{4}-\d{2})(-unreconciled)?\.json$/.exec(file),platform=match?.[1]??null,month=match?.[2]??null,quarantined=!!match?.[3],p=Array.isArray(d?.period)?{from:d.period[0],through:d.period[1]}:{from:d?.period?.from,through:d?.period?.to??d?.period?.through},s=source(file,d),issues=[];
 if(!documentValid)issues.push(issue('source_document_invalid'));if(!match)issues.push(issue('unsupported_ranking_filename'));if(!platform||d.platform!==platform)issues.push(issue('platform_key_mismatch'));if(d.complete!==true)issues.push(issue('ranking_incomplete','warning'));
 if(quarantined)issues.push(issue('quarantined_unreconciled_source','warning'));
 const periodValid=validDate(p.from)&&validDate(p.through)&&p.from<=p.through&&p.from.slice(0,7)===month&&p.through.slice(0,7)===month&&(p.from===month+'-01'||p.from===context.launchDates[platform]);
 if(!periodValid)issues.push(issue('ranking_period_invalid'));if(!s.captureTaipei)issues.push(issue('capture_time_missing'));else if(validDate(p.through)&&p.through>s.captureTaipei)issues.push(issue('ranking_through_after_capture'));
 const {header,rows}=table(d),cols=['AID','暱稱','儲值金額'].map(k=>header.indexOf(k)),ids=new Set(),headerValid=!cols.some(i=>i<0)&&!cols.some(i=>header.filter(h=>h===header[i]).length!==1);let duplicateCount=0,invalidIdCount=0,invalidCashCount=0,total=0;
 if(!headerValid)issues.push(issue('ranking_required_header_invalid'));
 else for(const r of rows){const rawAid=r[cols[0]],aid=rawAid==null?'':String(rawAid).trim(),cash=money(r[cols[2]]);if(!aid||(typeof rawAid==='number'&&!Number.isSafeInteger(rawAid)))invalidIdCount++;else if(ids.has(aid))duplicateCount++;else ids.add(aid);if(cash===null)invalidCashCount++;else total+=cash;}
 if(duplicateCount)issues.push(issue('ranking_duplicate_aid','error',{count:duplicateCount}));if(invalidIdCount)issues.push(issue('ranking_invalid_aid','error',{count:invalidIdCount}));if(invalidCashCount)issues.push(issue('ranking_invalid_cash','error',{count:invalidCashCount}));
 const rankCash=!headerValid||invalidCashCount?null:total;
 if(d.validation?.matching===false)issues.push(issue('source_ranking_validation_failed'));
 for(const field of ['rankingDeposit','dailyDeposit'])if(Object.hasOwn(d.validation??{},field)){const v=money(d.validation[field]);if(v===null||rankCash===null||Math.abs(v-rankCash)>.01)issues.push(issue('ranking_metadata_total_mismatch','error',{field,expected:v,actual:rankCash}));}
 const ref=periodValid?periodCash(reference,p.from,p.through,context.launchDates[platform]):null;
 const cashMatch=ref?.complete&&rankCash!==null?Math.abs(ref.cash-rankCash)<=.01:null;
 if(ref&&!ref.complete)issues.push(issue('ranking_daily_reference_incomplete','warning',{missingDateCount:ref.missingDates.length,unknownCashDateCount:ref.unknownCashDates.length}));
 if(cashMatch===false)issues.push(issue('ranking_vs_daily_cash_mismatch','error',{rankingCash:rankCash,dailyCash:ref.cash,delta:rankCash-ref.cash}));
 const todayPartial=validDate(p.through)&&p.through===context.today,currentMonthPartial=periodValid&&month===context.today.slice(0,7)&&p.through!==endOfMonth(month);
 if(todayPartial)issues.push(issue('ranking_includes_today_partial','info'));const dateValid=periodValid&&s.captureTaipei!==null&&p.through<=s.captureTaipei;
 return{...s,platform,month,period:p,canonical:!!match&&!quarantined,quarantined,sourceComplete:d.complete===true,completenessStatus:s.complete===true?'confirmed':s.complete===false?'incomplete':'unknown',periodValid:dateValid,currentMonthPartial,todayPartial,partialAtCapture:p.through===s.captureTaipei,rowCount:rows.length,uniqueAidCount:ids.size,rankingCash:rankCash,cashComparison:{status:cashMatch===true?'match':cashMatch===false?'mismatch':'not_verifiable',...ref,matching:cashMatch,delta:ref?.complete&&rankCash!==null?rankCash-ref.cash:null},acceptedForExactCashComparison:!quarantined&&d.complete===true&&dateValid&&!todayPartial&&cashMatch===true&&!issues.some(i=>i.severity==='error'),issues};
}
export function inspectMachine(file,d,context){
 const documentValid=d&&typeof d==='object'&&!Array.isArray(d);if(!documentValid)d={};
 const match=/^machine-([a-z0-9]+)-(\d{4}-\d{2})\.json$/.exec(file),platform=match?.[1]??null,month=match?.[2]??null,s=source(file,d),issues=[];
 if(!documentValid)issues.push(issue('source_document_invalid'));if(!match||![...OWN,...COMP].includes(platform)||d.platform!==platform)issues.push(issue('machine_platform_or_filename_invalid'));
 const periodValid=validDate(d.from)&&validDate(d.through)&&d.from<=d.through&&d.from===month+'-01'&&d.through.slice(0,7)===month;
 if(!periodValid)issues.push(issue('machine_period_invalid'));if(!s.captureTaipei)issues.push(issue('capture_time_missing'));else if(validDate(d.through)&&d.through>s.captureTaipei)issues.push(issue('machine_through_after_capture'));
 if(!validDate(d.queryThrough)||d.queryThrough<d.through||d.queryThrough.slice(0,7)!==month)issues.push(issue('machine_query_period_invalid'));
 const partial=validMonth(month)&&validDate(d.through)&&d.through!==endOfMonth(month),todayPartial=d.through===context.today;if(partial&&d.partial!==true)issues.push(issue('machine_partial_flag_missing'));
 if(todayPartial)issues.push(issue('machine_includes_today_partial','info'));
 if(d.validation?.valid===false)issues.push(issue('machine_source_validation_invalid'));if(d.validation?.periodWarning)issues.push(issue('machine_period_recheck_required'));
 const {header,rows}=table(d),indexes=['投注筆數','總投注額','總出分'].map(k=>header.indexOf(k)),totals=rows.filter(r=>r[0]==='加總'),details=rows.filter(r=>r[0]!=='加總');
 if(header.length!==11||indexes.some(i=>i<0)||details.some(r=>r.length!==11)||totals.length!==1||totals[0]?.length!==9)issues.push(issue('machine_table_shape_invalid'));
 const sums={},summary={},names=['rounds','bets','payouts'],summaryIndexes=[1,2,4];let totalsMatch=true;
 for(let i=0;i<names.length;i++){const values=details.map(r=>parseBackendNumber(r[indexes[i]]));sums[names[i]]=indexes[i]<0||values.some(v=>v===null)?null:values.reduce((a,b)=>a+b,0);summary[names[i]]=parseBackendNumber(totals[0]?.[summaryIndexes[i]]);if(sums[names[i]]===null||summary[names[i]]===null||Math.abs(sums[names[i]]-summary[names[i]])>.02)totalsMatch=false;}
 if(!totalsMatch)issues.push(issue('machine_detail_summary_mismatch','error',{sums,summary}));
 const complete=d.complete===true||d.validation?.complete===true;if(!complete)issues.push(issue('machine_incomplete','warning'));
 return{...s,platform,month,from:d.from??null,through:d.through??null,queryThrough:d.queryThrough??null,sourceComplete:complete,completenessStatus:complete?'confirmed':d.complete===false||d.validation?.complete===false?'incomplete':'unknown',periodValid:periodValid&&s.captureTaipei!==null&&d.through<=s.captureTaipei,periodValidationBasis:'source_metadata_constraints_only_not_row_totals',partial,todayPartial,rowCount:details.length,totalsMatch,sums,summary,valid:complete&&!issues.some(i=>i.severity==='error'),units:d.units??null,issues,detailSignature:createHash('sha256').update(JSON.stringify(details)).digest('hex')};
}

export async function buildQualityAudit(live=DEFAULT_LIVE,{today=captureDay(new Date().toISOString()),launchDates={win:'2026-01-16'},fallbackDaily={}}={}){
 if(!validDate(today))throw Error('Invalid audit date');const year=today.slice(0,4),context={today,year,launchDates},files=(await fs.readdir(live)).filter(f=>f.endsWith('.json')).sort(),docs=new Map(),readErrors=[];
 const relevant=files.filter(f=>/^backend-history-[a-z]+\.json$|^competitor-observations\.json$|^deposit-ranking-.*\.json$|^machine-.*\.json$/.test(f));
 for(const file of relevant)try{docs.set(file,JSON.parse((await fs.readFile(path.join(live,file),'utf8')).replace(/^\uFEFF/,'')));}catch{readErrors.push({file,code:'source_json_unreadable',severity:'error'});}
 const refs=new Map(),daily=[];
 for(const key of [...OWN,...COMP]){const own=OWN.includes(key),raw=own?docs.get('backend-history-'+key+'.json'):docs.get('competitor-observations.json')?.competitors?.find(c=>c.key===key),ref=dailyReference(raw,fallbackDaily[key]??[]);refs.set(key,ref);daily.push(inspectDaily(key,ref,context));}
 const rankings=[...docs].filter(([f])=>f.startsWith('deposit-ranking-')).map(([f,d])=>inspectRanking(f,d,refs.get(f.match(/^deposit-ranking-([a-z]+)-/)?.[1])??{rows:[]},context));
 const machines=[...docs].filter(([f])=>f.startsWith('machine-')).map(([f,d])=>inspectMachine(f,d,context));
 for(const m of machines){const identical=machines.filter(other=>other.platform===m.platform&&other.month!==m.month&&other.detailSignature===m.detailSignature&&m.rowCount>0);if(identical.length){m.issues.push(issue('identical_machine_details_across_periods','warning',{otherFiles:identical.map(o=>o.file)}));m.periodIdentityConfirmed=false;}else m.periodIdentityConfirmed=null;m.acceptedForAnalysis=m.valid&&m.periodIdentityConfirmed!==false;}
 const months=Array.from({length:Number(today.slice(5,7))},(_,i)=>year+'-'+String(i+1).padStart(2,'0'));
 const canonicalFiles=files.filter(f=>/^deposit-ranking-(win|qz|song|rd|lucky|bo)-\d{4}-\d{2}\.json$/.test(f));
 const coverage=OWN.map(platform=>{const r=rankings.filter(r=>r.platform===platform&&r.canonical),physical=canonicalFiles.filter(f=>f.startsWith('deposit-ranking-'+platform+'-')),expected=months.map(month=>({month,file:`deposit-ranking-${platform}-${month}.json`}));return{platform,expectedMonths:months,expectedFiles:expected.length,presentFiles:physical.length,readableFiles:r.length,unreadableFiles:readErrors.filter(e=>physical.includes(e.file)).map(e=>e.file),quarantinedFiles:rankings.filter(s=>s.platform===platform&&s.quarantined).map(s=>s.file),quarantinedMonths:rankings.filter(s=>s.platform===platform&&s.quarantined).map(s=>s.month),missingMonths:expected.filter(e=>!physical.includes(e.file)).map(e=>e.month),sourceCompleteMonths:r.filter(r=>r.sourceComplete).map(r=>r.month),calendarCompleteMonths:r.filter(r=>r.sourceComplete&&r.period.through===endOfMonth(r.month)).map(r=>r.month),cashReconciledMonths:r.filter(r=>r.acceptedForExactCashComparison).map(r=>r.month),incompleteFiles:r.filter(r=>r.completenessStatus==='incomplete').map(r=>r.file),unknownCompletenessFiles:r.filter(r=>r.completenessStatus==='unknown').map(r=>r.file),todayPartialFiles:r.filter(r=>r.todayPartial).map(r=>r.file),currentMonthPartialFiles:r.filter(r=>r.currentMonthPartial).map(r=>r.file)};});
 const allIssues=[...readErrors,...rankings.flatMap(r=>r.issues.map(i=>({...i,module:'payerRank',file:r.file,platform:r.platform,month:r.month}))),...machines.flatMap(r=>r.issues.map(i=>({...i,module:'machines',file:r.file,platform:r.platform,month:r.month}))),...daily.flatMap(r=>r.issues.map(i=>({...i,module:'daily',platform:r.platform})))];
 return{schema:1,generatedAt:new Date().toISOString(),auditThrough:today,lastCompleteDay:priorDay(today),coverage:{payerRanks:{expectedFiles:OWN.length*months.length,presentCanonicalFiles:canonicalFiles.length,readableCanonicalFiles:rankings.filter(r=>r.canonical).length,quarantinedSourceFiles:rankings.filter(r=>r.quarantined).map(r=>r.file),byPlatform:coverage},daily,machines:{sourceFiles:machines.length,validFiles:machines.filter(m=>m.acceptedForAnalysis).length,invalidFiles:machines.filter(m=>!m.acceptedForAnalysis).map(m=>m.file),todayPartialFiles:machines.filter(m=>m.todayPartial).map(m=>m.file)}},rankings,machines,mismatches:allIssues.filter(i=>i.severity==='error'),warnings:allIssues.filter(i=>i.severity==='warning'),partialSources:allIssues.filter(i=>i.severity==='info'),sourceReadErrors:readErrors,definitions:['排行金額僅與相同期間、完整且無重複日期的後台日報比對；缺日不能視為0。','Win開服前日期排除於日報完整性檢查；開服後缺日仍未知。','月末queryThrough可晚於採集日，但實際through不可晚於台灣採集日。','機台列加總吻合只驗證數值，不能證明查詢日期正確；source invalid及期間警示獨立保留。','當日未結、當月未結、來源未完整、金額不符分開列示。','此檔不包含會員AID、暱稱、LineID、電話或原始交易列。']};
}

if(process.argv[1]===fileURLToPath(import.meta.url)){
 const arg=(name,fallback)=>process.argv.find(a=>a.startsWith('--'+name+'='))?.slice(name.length+3)??fallback;
 const audit=await buildQualityAudit(arg('live',DEFAULT_LIVE),{today:arg('today',captureDay(new Date().toISOString()))}),output=arg('out',path.join(ROOT,'data/quality-audit.json'));
 await fs.writeFile(output,JSON.stringify(audit,null,2));console.log(JSON.stringify({output,rankFiles:audit.coverage.payerRanks.presentCanonicalFiles,expected:audit.coverage.payerRanks.expectedFiles,mismatches:audit.mismatches.length,warnings:audit.warnings.length}));
}
