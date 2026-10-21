import fs from 'node:fs/promises';
import path from 'node:path';
import {readDetailSources,detailSourceIssues,selectDetailSources,sourceReference} from './detail-source-selection.mjs';
/** Machine overview rows only. No network requests or vendor aggregate inference. */
const ALIASES={
 machineId:['machineId','機台ID','機台 ID','機台編號'],
 machineName:['machineName','機台名稱','機台'],gameName:['gameName','遊戲名稱'],
 vendor:['vendor','廠商名稱','供應商','遊戲供應商','廠商'],
 bets:['bets','投注','投注額','投注金額','總投注','總投注額','總投注金額'],
 payouts:['payouts','總出分','派彩','派彩金額','總派彩','總派彩金額'],
 rounds:['rounds','投注筆數','轉數','局數','總轉數','總局數'],players:['players','不重複玩家數','投注人數','玩家人數'],
 effectiveBets:['effectiveBets','有效投注額'],gameProfit:['gameProfit','遊戲淨利'],reportedRtp:['reportedRtp','RTP'],eventBonus:['eventBonus','活動加贈']
};
const text=v=>v==null?'':String(v).trim();
export function parseMachineNumber(value,{signed=false}={}){
 if(typeof value==='number')return Number.isFinite(value)&&(signed||value>=0)?value:null;
 if(typeof value!=='string')return null;
 const s=value.trim().replaceAll(',','');
 if(!(signed?/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/:/^\+?(?:\d+(?:\.\d*)?|\.\d+)$/).test(s))return null;
 const n=Number(s);return Number.isFinite(n)&&(signed||n>=0)?n:null;
}
function date(value){
 const s=text(value).slice(0,10);if(!/^\d{4}-\d{2}-\d{2}$/.test(s))return null;
 const d=new Date(s+'T00:00:00Z');return Number.isFinite(d.valueOf())&&d.toISOString().slice(0,10)===s?s:null;
}
function readField(raw,key,header,mapping){
 const named=mapping?.[key];
 if(named!==undefined){
  if(Array.isArray(raw)){const index=typeof named==='number'?named:header.indexOf(named);return index>=0?raw[index]:undefined}
  return raw[named];
 }
 if(!Array.isArray(raw)){for(const alias of ALIASES[key]||[key])if(Object.hasOwn(raw,alias))return raw[alias];return undefined}
 for(const alias of ALIASES[key]||[key]){const index=header.indexOf(alias);if(index>=0)return raw[index]}
 return undefined;
}
/**
 * Accept canonical objects or a captured {header,rows,platform,from,through,...}.
 * For unfamiliar headers pass options.mapping={machineId:'actual header',...}.
 * Mapping payouts must mean gross payout, never platform net win/loss.
 * A machine-name row may lack an ID: preserve null and label its actual grain.
 * Identity/period failures and conflicting duplicate snapshots are quarantined.
 * Missing numeric fields remain null. Original fields are retained under raw.
 */
export function normalizeMachineData(input,{mapping={},context={}}={}){
 const parent=Array.isArray(input)?{}:input||{},sourceRows=Array.isArray(input)?input:parent.rows||[];
 let header=Array.isArray(parent.header)?parent.header.map(text):[];
 let entries=sourceRows;
 if(!header.length&&Array.isArray(entries[0])&&entries[0].some(v=>[...ALIASES.machineId,...ALIASES.machineName].includes(text(v)))){header=entries[0].map(text);entries=entries.slice(1)}
 const rejected=[],warnings=[],totals=[],byKey=new Map(),conflicts=new Set();
 if(!Array.isArray(entries))return{rows:[],rejected:[{index:null,reasons:['rows must be an array']}],warnings:[],definitions:machineDefinitions()};
 entries.forEach((raw,index)=>{
  if(!raw||typeof raw!=='object'){rejected.push({index,reasons:['row is not an object or table row'],raw});return}
  const metadata={...context,...parent,...(!Array.isArray(raw)?raw:{})};
  // This report's footer has one label cell spanning vendor/name/player columns.
  // Expand only that known 11-column layout; retain the original footer in raw.
  const footerLayout=Array.isArray(raw)&&raw.length===9&&['加總','合計','總計'].includes(text(raw[0]))&&header.length===11&&header[0]==='廠商名稱'&&header[1]==='機台名稱'&&header[2]==='不重複玩家數'&&header[3]==='投注筆數';
  const values=footerLayout?[raw[0],'','',...raw.slice(1)]:raw;
  const get=key=>readField(values,key,header,mapping);
  const platform=text(metadata.platform),from=date(metadata.from||metadata.period?.from||metadata.period?.[0]),through=date(metadata.through||metadata.to||metadata.period?.to||metadata.period?.[1]);
  const machineId=text(get('machineId'))||null,machineName=text(get('machineName')),gameName=text(get('gameName')),vendor=text(get('vendor'));
  const reasons=[],level=text(metadata.granularity||metadata.level||metadata.scope).toLowerCase();
  const totalLabels=['加總','合計','總計','總和','全部','total','all','summary'];
  const isTotal=[machineId,machineName,vendor].some(v=>totalLabels.includes(text(v).toLowerCase()));
  const reportDetail=Array.isArray(raw)&&raw.length===11&&header[0]==='廠商名稱'&&header[1]==='機台名稱'&&header[4]==='總投注額'&&header[6]==='總出分';
  const identityMissing=!machineId&&!(machineName&&vendor);
  if(!platform)reasons.push('platform is required');
  if(!from||!through||from>through)reasons.push('valid from/through are required');
  if(identityMissing&&!isTotal&&!reportDetail)reasons.push('machineId or vendor plus machineName is required');
  if(!isTotal&&(metadata.isAggregate===true||metadata.aggregate===true||['vendor','provider','game','platform','aggregate','summary','total'].includes(level)))reasons.push('aggregate is not a machine observation');
  if(metadata.verified===false)reasons.push('source marked unverified');
  if(reasons.length){rejected.push({index,reasons,raw});return}
  const sourceRow=Number.isInteger(metadata.sourceRow)?metadata.sourceRow:index+1;
  const row={platform,from,through,machineId,machineName:machineName||null,gameName:gameName||null,vendor:vendor||null,identityMissing,sourceRow,granularity:machineId?'machine-id':identityMissing?'unidentified-source-row':'machine-name',unit:'遊戲幣',sourceUrl:text(metadata.sourceUrl)||null,capturedAt:text(metadata.capturedAt)||null,raw:Array.isArray(raw)?[...raw]:{...raw}};
  for(const key of ['bets','payouts','rounds','players','effectiveBets','gameProfit','eventBonus']){
   const value=get(key);let n=parseMachineNumber(value,{signed:key==='gameProfit'||key==='eventBonus'});
   if(['rounds','players'].includes(key)&&n!==null&&!Number.isInteger(n))n=null;
   row[key]=n;
   if(n===null)warnings.push({index,machineId,field:key,reason:value==null||text(value)===''?'missing numeric field':'unknown or invalid numeric field'});
  }
  const reported=get('reportedRtp');row.reportedRtpRaw=reported??null;
  const rtpNumber=parseMachineNumber(typeof reported==='string'?reported.replace(/[%％]$/,''):reported);
  const canonicalRtp=!Array.isArray(raw)&&Object.hasOwn(raw,'reportedRtp');
  row.reportedRtp=rtpNumber===null?null:canonicalRtp&&!(typeof reported==='string'&&/[%％]$/.test(reported.trim()))?rtpNumber:rtpNumber/100;
  row.rtp=row.bets>0&&row.payouts!==null?row.payouts/row.bets:null;
  row.platformLoss=row.bets!==null&&row.payouts!==null?row.payouts-row.bets:null;
  if(isTotal){row.granularity='summary';totals.push(row);return}
  // Name rows can legitimately repeat (e.g. two T9 entries). Source row is a
  // provenance key, never a fabricated machine ID. Only actual IDs deduplicate.
  const key=JSON.stringify([platform,from,through,vendor,gameName,machineId||machineName,...(machineId?[]:[sourceRow])]);
  row.observationKey=key;
  if(conflicts.has(key)){rejected.push({index,reasons:['conflicting duplicate machine/period'],raw});return}
  const previous=byKey.get(key);
  if(previous){
   if(['bets','payouts','rounds','players','effectiveBets','gameProfit','eventBonus','reportedRtp'].every(k=>previous.row[k]===row[k])){warnings.push({index,machineId,reason:'identical duplicate ignored'});return}
   rejected.push({index:previous.index,reasons:['conflicting duplicate machine/period'],raw:previous.row.raw},{index,reasons:['conflicting duplicate machine/period'],raw});
   byKey.delete(key);conflicts.add(key);return;
  }
  byKey.set(key,{index,row});
 });
 const rows=[...byKey.values()].map(v=>v.row),reconciliation={};
 const summary=totals.length===1?totals[0]:null;
 for(const field of ['bets','payouts','rounds','effectiveBets','gameProfit','eventBonus']){
  const sum=rows.length&&rows.every(r=>r[field]!==null)?rows.reduce((s,r)=>s+r[field],0):null;
  const reported=summary?.[field]??null;
  reconciliation[field]={sum,reported,matches:sum!==null&&reported!==null?Math.abs(sum-reported)<=Math.max(.02,Math.abs(reported)*1e-9):null};
 }
 return{rows,totals,rejected,warnings,reconciliation,definitions:machineDefinitions()};
}
export function machineDefinitions(){return{
 granularity:'來源機台總覽的名稱粒度。無 ID 時保留 null，以廠商＋機台名稱＋來源列序識別觀測列，保留同名列；不冒充機台 ID 或實體單機。供應商合計不當作機台。',
 bets:'來源投注額；不視為現金儲值或營收。',payouts:'來源總派彩；不能以淨輸贏直接填入。',
 platformLoss:'派彩 − 投注；大於 0 表示該期間平台在該機台失分。',
 rtp:'派彩 ÷ 投注；投注為 0 或欄位未知時為 null。',
 samples:'投注筆數依機台總覽來源作樣本門檻；未知時不作足量樣本判定。不重複玩家數不可跨機台相加當平台 MAU。',
 units:'投注、派彩與失分使用報表遊戲幣，未換算成台幣。',
 gameProfit:'來源遊戲淨利原值保留，不以計算的投注減派彩覆蓋；可能存在有效投注或加贈等口徑差異。',
 reportedRtp:'來源 RTP 原文字保留於 reportedRtpRaw；rtp 另按總出分除總投注額計算。'
}}
export async function buildMachineData(liveDir,{expected=[],platforms=[],months=[],today}={}){
 const candidates=await readDetailSources(liveDir,'machine'),records=[],rows=[],snapshots=[],comparisonRows=[],comparisonSnapshots=[],pending=[];
 for(const record of candidates){
  const source=record.snapshot,base=detailSourceIssues(record,{route:'/game-statements/statistics',today,requireClosed:false}),issues=[...base.issues];let normalized={rows:[],totals:[],rejected:[],warnings:[],reconciliation:{}};
  if(source){try{if(source.validation?.valid===false)issues.push('machine_source_validation_invalid');else normalized=normalizeMachineData(source,{context:{platform:record.platform}});if(normalized.rows.some(r=>!r.from.startsWith(record.month)||!r.through.startsWith(record.month)))issues.push('filename_period_mismatch');}catch{issues.push('machine_normalization_failed');}}
  if(record.versioned){
   if(!(source?.verified===true||source?.validation?.valid===true)||!(source?.complete===true||source?.validation?.complete===true))issues.push('machine_source_not_verified_complete');
   if(source?.validation?.summaryReconciled===false||source?.validation?.periodWarning)issues.push('machine_source_recheck_required');
   const vendor=source?.queryProof?.vendor??source?.queryProof?.selectedVendor;if(vendor!=null&&!['全部','全部廠商','all','ALL'].includes(vendor))issues.push('machine_vendor_scope_not_all');
   if(normalized.rejected.length)issues.push('machine_rows_rejected');
   const reconciled=(k,tolerance)=>{const r=normalized.reconciliation[k];return typeof r?.sum==='number'&&typeof r?.reported==='number'&&Math.abs(r.sum-r.reported)<=tolerance;};
   if(normalized.totals.length!==1||!reconciled('bets',.02)||!reconciled('payouts',.02)||!reconciled('rounds',0)||Object.entries(normalized.reconciliation).some(([k,r])=>typeof r.sum==='number'&&typeof r.reported==='number'&&Math.abs(r.sum-r.reported)>(k==='rounds'?0:.02)))issues.push('machine_summary_reconciliation_failed');
  }
  records.push({...record,period:base.period,issues:[...new Set(issues)],valid:issues.length===0,normalized});
 }
 const wanted=[...expected,...platforms.flatMap(p=>months.map(month=>({platform:typeof p==='string'?p:p.key,month})))],selection=selectDetailSources(records,{module:'machines',expected:wanted});
 const chosen=[...selection.selected],comparisonMap=new Map();for(const r of selection.comparisonSources){const key=r.platform+'|'+r.period.from+'|'+r.period.through,old=comparisonMap.get(key);if(!old||Date.parse(r.snapshot.capturedAt)>Date.parse(old.snapshot.capturedAt))comparisonMap.set(key,r);}chosen.push(...comparisonMap.values());
 // Keep one rejected period's metadata visible when no usable fallback exists.
 for(const r of records)if(!chosen.some(s=>s.platform===r.platform&&s.month===r.month)&&r.snapshot)chosen.push(r);
 for(const item of chosen){const source=item.snapshot,normalized=item.valid?item.normalized:{rows:[],totals:[],rejected:item.normalized.rejected,warnings:item.normalized.warnings,reconciliation:item.normalized.reconciliation},isComparison=item.scope==='comparison';(isComparison?comparisonRows:rows).push(...normalized.rows);
  const sourceValidation=item.versioned?{...source.validation,valid:item.valid,complete:item.valid,selectionIssues:item.issues}:source.validation??null;
  (isComparison?comparisonSnapshots:snapshots).push({scope:item.scope,platform:item.platform,month:item.month,file:item.file,from:source.from??null,through:source.through??null,queryThrough:source.queryThrough??null,partial:source.partial??null,partialMonth:source.partialMonth??null,currentDayPartial:source.currentDayPartial??null,capturedAt:source.capturedAt??null,sourceUrl:source.sourceUrl??null,unit:'遊戲幣',granularity:'machine-name',header:source.header??null,totals:normalized.totals,rejected:normalized.rejected,warnings:normalized.warnings,reconciliation:normalized.reconciliation,sourceValidation,rowCount:normalized.rows.length,sourceVersioned:item.versioned,queryProof:item.versioned?source.queryProof??null:null});
  if(!item.valid||!normalized.rows.length)pending.push({platform:item.platform,month:item.month,file:item.file,reason:source.validation?.periodWarning||(source.validation?.valid===false?'來源尚未核實，明細暫不納入':item.issues[0]??'尚無可用機台明細'),rejectedRows:normalized.rejected.length});
 }
 for(const gap of selection.domainCoverage.gaps)if(!snapshots.some(s=>s.platform===gap.platform&&s.month===gap.month)&&!pending.some(s=>s.platform===gap.platform&&s.month===gap.month))pending.push({platform:gap.platform,month:gap.month,file:gap.file,reason:gap.reason==='source_missing'?'尚未取得後台機台總覽':gap.reason});
 return{rows,snapshots,comparisonRows,comparisonSnapshots,pending,domainCoverage:selection.domainCoverage,unit:'遊戲幣',definitions:machineDefinitions()};
}
