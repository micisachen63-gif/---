import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {parseCompetitorNetworkSource} from './competitor-merchant-network.mjs';

export const O8_ARCHIVE_SCHEMA=1;
export const O8_HEADER=['名次','贈禮AID','贈禮暱稱','對象AID','對象暱稱','贈禮總金額','差額'];
export const O8_SOURCE_URL='https://admin.8o8.tw:9955/statements/giving';
export const sha256=value=>createHash('sha256').update(typeof value==='string'?value:JSON.stringify(value)).digest('hex');
export function archiveTaipeiDay(value=new Date()){const date=value instanceof Date?value:new Date(value);if(!Number.isFinite(date.getTime()))throw Error('invalid_capture_time');return new Date(date.getTime()+8*3600000).toISOString().slice(0,10);}
export function validIsoDay(value){return typeof value==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(value)&&Number.isFinite(Date.parse(value))&&new Date(value).toISOString().slice(0,10)===value;}
// The backend's seven-calendar-day selector includes today. Only six of those
// dates are closed; today-7 is already outside the observed access boundary.
export function o8ClosedCaptureDays(today=archiveTaipeiDay()){if(!validIsoDay(today))throw Error('invalid_capture_day');return Array.from({length:6},(_,i)=>new Date(Date.parse(today)-(6-i)*86400000).toISOString().slice(0,10));}
const integer=value=>typeof value==='number'?Number.isSafeInteger(value)?value:null:/^\d+$/.test(String(value??''))?Number(value):null;
export function validateO8Capture(source,date){
 const issues=[],add=value=>{if(!issues.includes(value))issues.push(value);};
 if(!validIsoDay(date))add('invalid_requested_day');
 if(source?.platform!=='o8'||source.from!==date||source.through!==date)add('date_or_platform_mismatch');
 if(JSON.stringify(source?.header)!==JSON.stringify(O8_HEADER))add('unexpected_header');
 const parsed=parseCompetitorNetworkSource('gift-daily-rank-o8-'+date+'.json',source);
 for(const issue of parsed.issues)add(issue);
 if(parsed.partial||parsed.captureDate<=date)add('day_not_closed_at_capture');
 if(parsed.validation.duplicatePairs)add('duplicate_directed_pair');
 const query=source?.queryProof||{};
 if(query.freshResultVerified!==true||query.selectedFrom!==date||query.selectedThrough!==date||query.verified!==true)add('fresh_query_proof_missing');
 if(!query.baselineSignature||!query.resultSignature||query.baselineSignature===query.resultSignature)add('query_result_not_independently_changed');
 const proof=source?.paginationProof,total=integer(source?.totalRows),pageSize=integer(proof?.pageSize),pages=proof?.pages;
 if(!proof||pageSize===null||pageSize<=0||total===null||integer(proof.totalRows)!==total||!Array.isArray(pages))add('pagination_proof_missing');
 else{
  if(pages.length!==Math.max(1,Math.ceil(total/pageSize)))add('pagination_page_count_mismatch');
  let offset=0;const hashes=new Set();
  for(let i=0;i<pages.length;i++){
   const page=pages[i],expected=Math.min(pageSize,Math.max(0,total-i*pageSize)),rows=source.rows?.slice(offset,offset+expected)||[],start=i*pageSize+1;
   if(integer(page.page)!==i+1||integer(page.rowCount)!==expected||page.selectedPageVerified!==true||page.rankMode!=='global')add('pagination_selection_or_count_unverified');
   if(rows.length!==expected||rows.some((row,j)=>integer(row[0])!==start+j))add('pagination_rank_sequence_mismatch');
   if(expected>0&&(integer(page.firstRank)!==start||integer(page.lastRank)!==start+expected-1))add('pagination_rank_range_mismatch');
   if(page.rowSha256!==sha256(rows))add('pagination_rows_hash_mismatch');
   if(expected>0&&hashes.has(page.rowSha256))add('pagination_duplicate_page');
   hashes.add(page.rowSha256);offset+=expected;
  }
  if(offset!==total||source.rows?.length!==total)add('pagination_total_mismatch');
  if(total===0&&query.emptyResultVerified!==true)add('empty_result_not_verified');
 }
 return{valid:issues.length===0,issues,date,capturedAt:source?.capturedAt??null,totalRows:total,closedAtCapture:!parsed.partial&&parsed.captureDate>date};
}
export async function readArchiveJson(file,fallback=null){try{return JSON.parse((await fs.readFile(file,'utf8')).replace(/^\uFEFF/,''));}catch(error){if(error.code==='ENOENT')return fallback;throw error;}}
export async function atomicArchiveJson(file,data){await fs.mkdir(path.dirname(file),{recursive:true});const temp=file+'.'+randomUUID()+'.tmp';await fs.writeFile(temp,JSON.stringify(data,null,2),'utf8');try{await fs.rename(temp,file);}finally{await fs.unlink(temp).catch(error=>{if(error.code!=='ENOENT')throw error;});}}
export async function storeO8Capture(archiveRoot,source){
 const date=source?.from,validation=validateO8Capture(source,date);if(!validation.valid){const error=Error('capture_validation_failed');error.issues=validation.issues;throw error;}
 const snapshot={...source,archive:{schema:O8_ARCHIVE_SCHEMA,captureKind:'closed_daily_gift_ranking',closedAtCapture:true,validation}};
 const serialized=JSON.stringify(snapshot,null,2),digest=sha256(serialized),stamp=new Date(source.capturedAt).toISOString().replace(/[:.]/g,'-'),relative=path.posix.join('daily',date,stamp+'-'+digest.slice(0,16)+'.json'),filename=path.join(archiveRoot,...relative.split('/'));
 await fs.mkdir(path.dirname(filename),{recursive:true});let deduplicated=false;
 try{await fs.writeFile(filename,serialized,{encoding:'utf8',flag:'wx'});}catch(error){if(error.code!=='EEXIST')throw error;if(sha256(await fs.readFile(filename,'utf8'))!==digest)throw Error('immutable_capture_collision');deduplicated=true;}
 const indexFile=path.join(archiveRoot,'index.json'),index=await readArchiveJson(indexFile,{schema:O8_ARCHIVE_SCHEMA,platform:'o8',days:{}}),prior=index.days?.[date];
 index.days??={};if(!prior||Date.parse(source.capturedAt)>=Date.parse(prior.capturedAt))index.days[date]={date,latestFile:relative,capturedAt:source.capturedAt,sha256:digest,totalRows:source.totalRows,closedAtCapture:true};
 index.updatedAt=new Date().toISOString();await atomicArchiveJson(indexFile,index);
 return{date,file:relative,capturedAt:source.capturedAt,sha256:digest,totalRows:source.totalRows,deduplicated};
}
export async function archiveCoverage(archiveRoot,dates){const index=await readArchiveJson(path.join(archiveRoot,'index.json'),{days:{}}),covered=[],missing=[];for(const date of dates){const entry=index.days?.[date],relative=String(entry?.latestFile||'');if(!entry||!/^daily\/\d{4}-\d{2}-\d{2}\/[A-Za-z0-9-]+\.json$/.test(relative)||relative.split('/')[1]!==date){missing.push(date);continue;}const source=await readArchiveJson(path.join(archiveRoot,...relative.split('/')));if(source&&validateO8Capture(source,date).valid)covered.push(date);else missing.push(date);}return{coveredDates:covered,missingDates:missing};}
