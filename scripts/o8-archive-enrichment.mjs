import fs from 'node:fs/promises';
import path from 'node:path';
import {parseBackendNumber} from './backend-metrics.mjs';
import {archiveTaipeiDay,validIsoDay,sha256,atomicArchiveJson} from './o8-archive-store.mjs';

export const O8_CASH_HEADER=['日期','DAU','DPU','總筆數','總金額','儲值率','ARPU','ARPPU','首儲人數','首儲總額'];
export const O8_GLOBAL_GIFT_HEADER=['日期','新贈禮總金額','新總手續費','總贈禮人數','總收禮人數','總贈禮筆數','成功贈禮筆數'];
const fail=issues=>Object.assign(Error('enrichment_validation_failed'),{code:'enrichment_validation_failed',issues});
function expectedDays(from,through){const result=[];if(!validIsoDay(from)||!validIsoDay(through)||from>through)return result;for(let t=Date.parse(from);t<=Date.parse(through);t+=86400000)result.push(new Date(t).toISOString().slice(0,10));return result;}
export function validateO8Enrichment(source,kind,{from=source?.from,through=source?.through,attemptAt=null,now=new Date()}={}){
 const header=kind==='cash'?O8_CASH_HEADER:kind==='globalGift'?O8_GLOBAL_GIFT_HEADER:null,issues=[],add=code=>{if(!issues.includes(code))issues.push(code);},days=expectedDays(from,through),captureTime=Date.parse(source?.capturedAt),current=now instanceof Date?now.getTime():Date.parse(now);
 if(!header||source?.platform!=='o8'||source.from!==from||source.through!==through||!days.length)add('enrichment_period_mismatch');
 const route=kind==='cash'?'/statements/player-summary':'/statements/giving';try{const url=new URL(source?.sourceUrl);if(url.origin!=='https://admin.8o8.tw:9955'||url.pathname.replace(/\/$/,'')!==route||url.username||url.password)add('enrichment_source_url_invalid');}catch{add('enrichment_source_url_invalid');}
 if(source?.tab!==(kind==='cash'?'玩家消費':'日報表')||JSON.stringify(source?.header)!==JSON.stringify(header))add('enrichment_header_or_tab_changed');
 if(!Number.isFinite(captureTime)||through>=archiveTaipeiDay(Number.isFinite(captureTime)?new Date(captureTime):now)||source?.currentDayPartial===true)add('enrichment_not_closed_at_capture');
 if(attemptAt!==null&&(captureTime<Date.parse(attemptAt)-2000||captureTime>current+2000))add('stale_enrichment_capture');
 const query=source?.queryProof;if(source?.complete!==true||query?.verified!==true||query.selectedFrom!==from||query.selectedThrough!==through||query.freshResultVerified!==true||!query.baselineSignature||!query.resultSignature||query.baselineSignature===query.resultSignature)add('enrichment_date_or_freshness_unverified');
 const rows=Array.isArray(source?.rows)?source.rows:[],seen=new Set();
 for(const row of rows){if(!Array.isArray(row)||row.length!==header?.length||!validIsoDay(row[0])||!days.includes(row[0])||seen.has(row[0])){add('enrichment_daily_rows_invalid');continue;}seen.add(row[0]);for(let index=1;index<row.length;index++){const value=parseBackendNumber(row[index]),required=kind==='globalGift'||[1,2,3,4,8,9].includes(index);if(required&&value===null||value!==null&&value<0)add('enrichment_numeric_invalid');}}
 const missingDates=days.filter(date=>!seen.has(date));if(rows.length!==days.length||missingDates.length)add('enrichment_daily_dates_missing');
 let displayedTotalVerified=false,cashSum=null;
 if(kind==='cash'&&header){cashSum=rows.length===days.length&&rows.every(row=>parseBackendNumber(row[4])!==null)?rows.reduce((sum,row)=>sum+parseBackendNumber(row[4]),0):null;const footers=source?.footerRows||[],totals=footers.filter(row=>row[0]==='加總');if(totals.length!==1||cashSum===null||parseBackendNumber(totals[0]?.[4])===null||Math.abs(parseBackendNumber(totals[0]?.[4])-cashSum)>.01)add('cash_displayed_sum_mismatch');else displayedTotalVerified=true;const average=footers.find(row=>row[0]==='平均');if(average&&cashSum!==null&&(parseBackendNumber(average[4])===null||Math.abs(parseBackendNumber(average[4])-cashSum/days.length)>.02))add('cash_displayed_average_mismatch');}
 return{valid:issues.length===0,issues,missingDates,days:days.length,displayedTotalVerified,cashSum};
}
export async function storeO8Enrichment(live,archiveRoot,source,kind,options={}){
 const validation=validateO8Enrichment(source,kind,options);if(!validation.valid)throw fail(validation.issues);
 const prefix=kind==='cash'?'competitor-cash-range-o8-':'competitor-gift-summary-o8-',file=prefix+source.from+'_'+source.through+'.json',target=path.join(live,file),serialized=JSON.stringify({...source,validation},null,2),folder=path.join(archiveRoot,'enrichment',kind);
 await fs.mkdir(folder,{recursive:true});
 async function immutable(bytes,capturedAt,role){const hash=sha256(bytes),stamp=new Date(capturedAt).toISOString().replace(/[:.]/g,'-'),name=file.replace(/\.json$/,'')+'-'+stamp+'-'+role+'-'+hash.slice(0,16)+'.json',destination=path.join(folder,name);try{await fs.writeFile(destination,bytes,{encoding:'utf8',flag:'wx'});}catch(error){if(error.code!=='EEXIST'||sha256(await fs.readFile(destination,'utf8'))!==hash)throw error;}return path.relative(live,destination).replaceAll('\\','/');}
 const snapshotFile=await immutable(serialized,source.capturedAt,'capture');
 try{const old=await fs.readFile(target,'utf8'),previous=JSON.parse(old);await immutable(old,previous.capturedAt||source.capturedAt,'previous');}catch(error){if(error.code!=='ENOENT')throw error;}
 await atomicArchiveJson(target,{...source,validation});return{ok:true,from:source.from,through:source.through,capturedAt:source.capturedAt,error:null,file,snapshotFile,days:validation.days,displayedTotalVerified:validation.displayedTotalVerified};
}
