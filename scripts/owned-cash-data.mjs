import fs from 'node:fs/promises';
import path from 'node:path';
import {normalizeDaily,splitTodayProgress,currentTaipeiDay,parseBackendNumber} from './backend-metrics.mjs';
import {MERCHANT_IDENTITY_REGISTRY} from './merchant-identities.mjs';

const validDate=s=>typeof s==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(s)&&Number.isFinite(Date.parse(s))&&new Date(s).toISOString().slice(0,10)===s;
const dates=(from,through)=>{const out=[];if(!validDate(from)||!validDate(through)||from>through)return out;for(let t=Date.parse(from);t<=Date.parse(through);t+=86400000)out.push(new Date(t).toISOString().slice(0,10));return out;};

export function parseOwnedCashSource(file,raw,{today=currentTaipeiDay()}={}){
 const match=/^owned-cash-range-(win|qz|song|rd|lucky|bo)-(\d{4}-\d{2}-\d{2})_(\d{4}-\d{2}-\d{2})\.json$/.exec(file),platform=match?.[1]??raw?.platform,from=raw?.from,through=raw?.through,issues=[],capturedAt=raw?.capturedAt??null,proof=raw?.queryProof;
 const add=s=>{if(!issues.includes(s))issues.push(s);};
 if(!match||raw?.platform!==platform||from!==match?.[2]||through!==match?.[3]||!dates(from,through).length)add('filename_platform_or_period_mismatch');
 try{const u=new URL(raw.sourceUrl);if(u.protocol!=='https:'||u.host!==MERCHANT_IDENTITY_REGISTRY.platforms[platform]?.host||u.pathname.replace(/\/$/,'')!=='/statements/player-summary'||u.username||u.password)add('untrusted_cash_source');}catch{add('untrusted_cash_source');}
 if(raw?.tab!=='玩家消費'||raw?.complete!==true)add('cash_report_not_complete_or_wrong_tab');
 if(proof?.verified!==true||proof.selectedFrom!==from||proof.selectedThrough!==through)add('cash_selected_dates_not_verified');
 if(!capturedAt||!Number.isFinite(Date.parse(capturedAt)))add('cash_capture_time_missing');
 const captureDay=capturedAt&&Number.isFinite(Date.parse(capturedAt))?new Date(Date.parse(capturedAt)+8*3600000).toISOString().slice(0,10):null;
 if(captureDay&&captureDay>today)add('cash_capture_after_analysis_day');
 if(captureDay&&validDate(through)&&through>captureDay)add('cash_query_after_capture_day');
 const h=raw?.header??[],cashCol=h.findIndex(v=>['總金額','儲值金額'].includes(String(v).trim()));
 if(!Array.isArray(raw?.rows)||!h.includes('日期')||cashCol<0)add('cash_required_columns_missing');
 let rows=[];try{rows=normalizeDaily(raw);}catch{add('cash_duplicate_dates');}
 if(rows.some(r=>!validDate(r[0])||r[0]<from||r[0]>through))add('cash_row_outside_selected_period');
 if(rows.some(r=>typeof r[4]!=='number'||!Number.isFinite(r[4])||r[4]<0))add('cash_amount_invalid');
 const footerRows=[...(Array.isArray(raw?.rows)?raw.rows:[]),...(Array.isArray(raw?.footerRows)?raw.footerRows:[])],totals=footerRows.filter(r=>Array.isArray(r)&&/^(?:總和|合計|總計|加總)$/.test(String(r[0]??'').trim())).map(r=>parseBackendNumber(r[cashCol])),sum=rows.reduce((s,r)=>s+(r[4]??0),0);
 if(totals.some(v=>v===null||Math.abs(v-sum)>.011))add('cash_footer_sum_mismatch');
 const split=splitTodayProgress(rows,{platform,capturedAt,sourceUrl:raw?.sourceUrl},today),observed=new Set(split.daily.map(r=>r[0])),expected=dates(from,through).filter(d=>d<today),missingDates=expected.filter(d=>!observed.has(d));
 return{file,platform,from,through,capturedAt,sourceUrl:raw?.sourceUrl??null,queryProof:proof??null,complete:issues.length===0,calendarCoverageComplete:missingDates.length===0,missingDates,observedRows:rows.length,closedRows:split.daily.length,footerComparison:{available:totals.length>0,reported:totals[0]??null,observedSum:sum,valid:totals.length?totals.every(v=>v!==null&&Math.abs(v-sum)<=.011):null},validation:{valid:issues.length===0,issues},rows:issues.length?[]:split.daily,todayProgress:issues.length?null:split.todayProgress,closure:split.coverage};
}

export async function buildOwnedCashSources(live,{today=currentTaipeiDay()}={}){
 const names=(await fs.readdir(live)).filter(f=>/^owned-cash-range-.*\.json$/.test(f)).sort(),sources=[];
 for(const file of names)try{sources.push(parseOwnedCashSource(file,JSON.parse((await fs.readFile(path.join(live,file),'utf8')).replace(/^\uFEFF/,'')),{today}));}catch{sources.push({file,platform:null,complete:false,rows:[],validation:{valid:false,issues:['cash_json_unreadable']}});}
 return sources;
}

// Merge only closed daily observations; the backend monthly/active/registration
// objects remain untouched. A sparse query never deletes a previously known day.
export function mergeOwnedCashSources(history,historyTime,sources){
 for(const source of sources){if(!source.complete)continue;const platform=source.platform,stamp=Date.parse(source.capturedAt);history[platform]??=new Map();historyTime[platform]??=new Map();for(const row of source.rows){if(stamp>=(historyTime[platform].get(row[0])??0)){history[platform].set(row[0],[...row]);historyTime[platform].set(row[0],stamp);}}}
 return{history,historyTime};
}

export function ownedCashEvidence(sources){return sources.map(({rows,todayProgress,...metadata})=>metadata);}
