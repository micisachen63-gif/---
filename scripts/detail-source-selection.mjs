import fs from 'node:fs/promises';import path from 'node:path';
import {currentTaipeiDay,parseBackendNumber,normalizeDaily,splitTodayProgress} from './backend-metrics.mjs';
import {buildOwnedCashSources} from './owned-cash-data.mjs';
import {parseCompetitorCashSource} from './competitor-funding.mjs';
export const DETAIL_PLATFORM_HOSTS={win:'admin.winmalo.com:9955',qz:'admin.qzplays.com:9955',song:'admin.song-yy.com:9955',rd:'admin.rdplays.com:9955',lucky:'admin.lylucky.com:9955',bo:'admin.lybobet.com:9955',o8:'admin.8o8.tw:9955',aos:'admin.aos888.com:9955',fcc:'admin.fcc99.com:9955',cgb:'admin.cgb777.com:9955',goldfun:'admin.goldfun88.com:9955',o9:'admin.o9play.com:9955'};
export const validDetailDate=d=>typeof d==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(d)&&Number.isFinite(Date.parse(d))&&new Date(d).toISOString().slice(0,10)===d;
export const detailCaptureDay=t=>typeof t==='string'&&Number.isFinite(Date.parse(t))?new Date(Date.parse(t)+8*3600000).toISOString().slice(0,10):null;
export function detailPeriod(s){return Array.isArray(s?.period)?{from:s.period[0],through:s.period[1]}:{from:s?.period?.from??s?.from,through:s?.period?.to??s?.period?.through??s?.through};}
export function classifyDetailFilename(file,kind='ranking'){
 const prefix=kind==='machine'?'machine':'deposit-ranking',keys=Object.keys(DETAIL_PLATFORM_HOSTS).join('|'),re=new RegExp('^'+prefix+'-('+keys+')-(\\d{4}-\\d{2})(?:-(\\d{2})_(\\d{4}-\\d{2}-\\d{2}))?(?:-asof-(\\d{8}))?(-unreconciled)?\\.json$'),m=re.exec(file);if(!m)return null;
 return{file,kind,platform:m[1],month:m[2],scope:m[3]?'comparison':'monthly',filenameFrom:m[3]?m[2]+'-'+m[3]:null,filenameThrough:m[4]??null,versioned:!!m[5],asOf:m[5]?m[5].slice(0,4)+'-'+m[5].slice(4,6)+'-'+m[5].slice(6):null,quarantined:!!m[6]};
}
export async function readDetailSources(live,kind='ranking'){
 const records=[];for(const file of (await fs.readdir(live)).sort()){const meta=classifyDetailFilename(file,kind);if(!meta)continue;try{records.push({...meta,snapshot:JSON.parse((await fs.readFile(path.join(live,file),'utf8')).replace(/^\uFEFF/,''))});}catch{records.push({...meta,snapshot:null,readError:'source_json_unreadable'});}}
 return records;
}
export function detailSourceIssues(record,{route,today=currentTaipeiDay(),requireClosed=true}={}){
 const s=record.snapshot,issues=[],p=detailPeriod(s),captureDay=detailCaptureDay(s?.capturedAt),add=r=>{if(!issues.includes(r))issues.push(r);};
 if(record.readError||!s||typeof s!=='object')add('source_json_unreadable');
 if(record.quarantined)add('quarantined_unreconciled_source');
 if(s?.platform&&s.platform!==record.platform)add('platform_key_mismatch');
 if(!validDetailDate(p.from)||!validDetailDate(p.through)||p.from>p.through||p.from.slice(0,7)!==record.month||p.through.slice(0,7)!==record.month)add('invalid_source_period');
 if(captureDay&&validDetailDate(p.through)&&p.through>captureDay)add('source_period_after_capture_day');
 if(record.scope==='comparison'&&(p.from!==record.filenameFrom||p.through!==record.filenameThrough))add('filename_period_mismatch');
 // Canonical captures retain their pre-existing reviewed trust contract. New
 // versioned files must independently prove their exact authorized backend URL.
 if(record.versioned)try{const u=new URL(s?.sourceUrl);if(u.protocol!=='https:'||u.host!==DETAIL_PLATFORM_HOSTS[record.platform]||u.pathname.replace(/\/$/,'')!==route||u.username||u.password)add('untrusted_source_url');}catch{add('untrusted_source_url');}
 if(record.versioned){
  if(s?.platform!==record.platform)add('platform_key_mismatch');
  if(!captureDay||captureDay!==record.asOf||!validDetailDate(record.asOf)||captureDay>today)add('invalid_version_capture_day');
  if(requireClosed&&(!captureDay||p.through>=captureDay||s?.currentDayPartial===true))add('source_not_closed_at_capture');
  const proof=s?.queryProof,selected=v=>typeof v==='string'?v.slice(0,10):null,queryThrough=record.kind==='machine'?String(s?.queryThrough??p.through).slice(0,10):p.through;if(proof?.verified!==true||selected(proof.selectedFrom)!==p.from||selected(proof.selectedThrough)!==queryThrough)add('selected_dates_not_verified');
  if(record.kind==='machine'&&(!validDetailDate(queryThrough)||queryThrough<p.through||queryThrough.slice(0,7)!==record.month))add('invalid_machine_query_period');
  if(record.scope==='monthly'&&p.from!==record.month+'-01')add('monthly_source_requires_day_one');
  if(record.scope==='monthly'&&captureDay&&record.month<captureDay.slice(0,7)&&p.through!==new Date(Date.UTC(Number(record.month.slice(0,4)),Number(record.month.slice(5)),0)).toISOString().slice(0,10))add('past_main_month_requires_full_month');
 }
 return{issues,period:p,captureDay};
}
export function sourceReference(r){return{platform:r.platform,month:r.month,file:r.file,scope:r.scope,versioned:r.versioned,period:r.period??detailPeriod(r.snapshot),capturedAt:r.snapshot?.capturedAt??null,valid:r.valid===true,issues:r.issues??[]};}
export function selectDetailSources(records,{module='detail',expected=[]}={}){
 const selected=[],comparisonSources=[],gaps=records.filter(r=>!r.valid).map(r=>({...sourceReference(r),reason:r.issues?.[0]??'source_invalid'})),groups=new Map();
 for(const r of records.filter(r=>r.valid)){if(r.scope==='comparison'){comparisonSources.push(r);continue;}const key=r.platform+'|'+r.month;(groups.get(key)??(groups.set(key,[]),groups.get(key))).push(r);}
 for(const list of groups.values()){list.sort((a,b)=>Number(b.versioned)-Number(a.versioned)||(b.period?.through??'').localeCompare(a.period?.through??'')||(Date.parse(b.snapshot?.capturedAt)||0)-(Date.parse(a.snapshot?.capturedAt)||0)||a.file.localeCompare(b.file));selected.push(list[0]);}
 for(const e of expected)if(!selected.some(r=>r.platform===e.platform&&r.month===e.month))gaps.push({platform:e.platform,month:e.month,file:null,reason:'source_missing',issues:['source_missing']});
 selected.sort((a,b)=>a.platform.localeCompare(b.platform)||a.month.localeCompare(b.month));comparisonSources.sort((a,b)=>a.platform.localeCompare(b.platform)||a.period.from.localeCompare(b.period.from)||a.period.through.localeCompare(b.period.through)||(Date.parse(b.snapshot.capturedAt)||0)-(Date.parse(a.snapshot.capturedAt)||0));
 return{selected,comparisonSources,domainCoverage:{module,selected:selected.map(sourceReference),comparisons:comparisonSources.map(sourceReference),gaps},candidates:records.map(sourceReference)};
}
function money(v){if(typeof v==='boolean'||v==null||String(v).trim()==='')return null;const text=String(v).trim().replaceAll(',','');return /^(?:\d+)(?:\.\d+)?$/.test(text)&&Number.isFinite(Number(text))?Number(text):null;}
export function parseRankingDetail(record,{dailyByPlatform=null,today=currentTaipeiDay()}={}){
 const {issues,period,captureDay}=detailSourceIssues(record,{route:'/statements/deposit-ranking',today}),s=record.snapshot??{},add=r=>{if(!issues.includes(r))issues.push(r);},header=Array.isArray(s.header)?s.header:s.rows?.[0],rows=Array.isArray(s.header)?s.rows:s.rows?.slice(1),map=new Map();let total=0;
 if(s.complete!==true)add('ranking_incomplete');
 if(s.permissionDenied===true||s.memberDetailsAvailable===false||s.access?.memberDetails===false)add('member_details_not_permitted');
 const positions=name=>Array.isArray(header)?header.flatMap((v,i)=>String(v??'').trim()===name?[i]:[]):[],cols=['AID','暱稱','儲值金額'].map(positions);if(cols.some(c=>c.length!==1)||!Array.isArray(rows))add('ranking_columns_missing_or_duplicated');
 if(!issues.length||cols.every(c=>c.length===1)&&Array.isArray(rows))for(const row of rows??[]){if(!Array.isArray(row)){add('ranking_row_invalid');continue;}const raw=row?.[cols[0][0]],aid=raw==null?'':String(raw).trim(),cash=money(row?.[cols[2][0]]);if(!aid||typeof raw==='number'&&!Number.isSafeInteger(raw)){add('ranking_aid_invalid');continue;}if(map.has(aid)){add('ranking_aid_duplicate');continue;}if(cash===null){add('ranking_cash_invalid');continue;}total+=cash;const li=Array.isArray(header)?header.indexOf('最後操作時間'):-1;map.set(aid,{aid,name:row[cols[1][0]]==null?null:String(row[cols[1][0]]),cash,lastAction:li<0?null:row[li]??null});}
 if(s.totalRows!=null&&parseBackendNumber(s.totalRows)!==rows?.length)add('ranking_total_rows_mismatch');
 const v=s.validation??{},comparison=s.cashComparison??{};if(v.valid===false||v.matching===false||comparison.matching===false)add('ranking_cash_reconciliation_failed');
 for(const n of [v.rankingDeposit,v.dailyDeposit,comparison.rankingCash,comparison.dailyCash].filter(n=>n!==undefined))if(money(n)===null||Math.abs(money(n)-total)>.011)add('ranking_cash_total_mismatch');
 const cashRows=dailyByPlatform?.[record.platform],expected=validDetailDate(period.from)&&validDetailDate(period.through)?(()=>{const out=[];for(let t=Date.parse(period.from);t<=Date.parse(period.through);t+=86400000)out.push(new Date(t).toISOString().slice(0,10));return out;})():[],byDate=new Map((cashRows??[]).map(r=>[r[0],r[4]])),referenceComplete=expected.length>0&&expected.every(d=>typeof byDate.get(d)==='number'&&Number.isFinite(byDate.get(d))&&byDate.get(d)>=0),referenceTotal=referenceComplete?expected.reduce((n,d)=>n+byDate.get(d),0):null;
 if(referenceComplete&&Math.abs(referenceTotal-total)>.011)add('ranking_vs_daily_cash_mismatch');
 if(record.versioned){
  const hasVerifiedMetadata=(v.matching===true&&money(v.dailyDeposit)!==null)||(comparison.matching===true&&money(comparison.dailyCash)!==null);if(!referenceComplete&&!hasVerifiedMetadata)add('ranking_cash_reconciliation_missing');
  if(s.totalRows==null)add('ranking_total_rows_missing');
  const pp=s.paginationProof,tp=s.tableProof,rankIndex=Array.isArray(header)?header.indexOf('名次'):-1;
  if(['unpaginated_full_table','unpaginated_full_dom'].includes(tp?.mode)){
   if((tp.noPaginationObserved??tp.noPager)!==true||(tp.rankSequenceVerified??tp.contiguousRanks)!==true||parseBackendNumber(tp.observedRows??tp.rowsRead)!==rows?.length||rankIndex<0||rows.some((r,i)=>parseBackendNumber(r[rankIndex])!==i+1))add('ranking_full_table_not_verified');
  }else if(pp){
   const size=parseBackendNumber(pp.pageSize);if(!Number.isSafeInteger(size)||size<=0||!Array.isArray(pp.pages)||parseBackendNumber(pp.totalRows)!==rows?.length||pp.pages.length!==Math.max(1,Math.ceil(rows.length/size)))add('ranking_pagination_not_verified');
   else for(let i=0;i<pp.pages.length;i++){const page=pp.pages[i],count=Math.min(size,Math.max(0,rows.length-i*size)),local=page.rankMode==='page-local',start=local?1:i*size+1,part=rows.slice(i*size,i*size+count);if(parseBackendNumber(page.page)!==i+1||parseBackendNumber(page.rowCount)!==count||local&&i>0&&page.selectedPageVerified!==true||count&&(parseBackendNumber(page.firstRank)!==start||parseBackendNumber(page.lastRank)!==start+count-1)||rankIndex<0||part.some((r,j)=>parseBackendNumber(r[rankIndex])!==start+j))add('ranking_pagination_not_verified');}
  }else add('ranking_table_completeness_not_verified');
  if(rows?.length===0&&s.queryProof?.emptyResultVerified!==true)add('empty_result_unverified');
 }
 return{...record,period,captureDay,map,total,valid:issues.length===0,issues,cashComparison:{complete:referenceComplete,value:referenceTotal,delta:referenceTotal!==null?total-referenceTotal:null}};
}
async function independentDaily(live,today){
 const by={},times={},add=(platform,rows,capturedAt)=>{by[platform]??=new Map();times[platform]??=new Map();for(const row of rows){const stamp=Date.parse(capturedAt)||0;if(stamp>=(times[platform].get(row[0])??0)){by[platform].set(row[0],row);times[platform].set(row[0],stamp);}}};
 for(const file of (await fs.readdir(live)).filter(f=>/^backend-history-[a-z]+\.json$/.test(f)))try{const s=JSON.parse((await fs.readFile(path.join(live,file),'utf8')).replace(/^\uFEFF/,'')),key=/^backend-history-(.+)\.json$/.exec(file)[1];if(Array.isArray(s.daily))add(key,splitTodayProgress(s.daily,{capturedAt:s.dailyCapturedAt??s.capturedAt},today).daily,s.dailyCapturedAt??s.capturedAt);const c=s.consumeDaily??s.tables?.consumeDaily;if(c)add(key,splitTodayProgress(normalizeDaily(c),{capturedAt:c.capturedAt??s.capturedAt},today).daily,c.capturedAt??s.capturedAt);}catch{}
 for(const s of await buildOwnedCashSources(live,{today}))if(s.complete)add(s.platform,s.rows,s.capturedAt);
 for(const file of (await fs.readdir(live)).filter(f=>/^competitor-cash-range-(o8|aos|fcc|cgb|goldfun|o9)-.*\.json$/.test(f)))try{const s=parseCompetitorCashSource(file,JSON.parse((await fs.readFile(path.join(live,file),'utf8')).replace(/^\uFEFF/,''))),u=new URL(s.sourceUrl);if(s.validation.valid&&u.protocol==='https:'&&u.host===DETAIL_PLATFORM_HOSTS[s.platform]&&u.pathname.replace(/\/$/,'')==='/statements/player-summary')add(s.platform,splitTodayProgress(s.rows,s,today).daily,s.capturedAt);}catch{}
 return Object.fromEntries(Object.entries(by).map(([k,v])=>[k,[...v.values()]]));
}
export async function loadRankingSources(live,{dailyByPlatform=null,today=currentTaipeiDay(),expected=null}={}){
 const references=dailyByPlatform??await independentDaily(live,today),raw=await readDetailSources(live,'ranking'),records=raw.map(r=>parseRankingDetail(r,{dailyByPlatform:references,today})),months=[...new Set(records.map(r=>r.month))],wanted=expected??Object.keys(DETAIL_PLATFORM_HOSTS).flatMap(platform=>months.map(month=>({platform,month})));return selectDetailSources(records,{module:'payerRank',expected:wanted});
}
