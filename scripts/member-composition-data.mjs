import fs from 'node:fs/promises';import path from 'node:path';
import {currentTaipeiDay} from './backend-metrics.mjs';
import {buildOwnedRegistrationPeriods} from './owned-registration-data.mjs';
import {buildRegistrationPeriods} from './registration-period-data.mjs';
const HOSTS={win:'admin.winmalo.com:9955',qz:'admin.qzplays.com:9955',song:'admin.song-yy.com:9955',rd:'admin.rdplays.com:9955',lucky:'admin.lylucky.com:9955',bo:'admin.lybobet.com:9955',o8:'admin.8o8.tw:9955',aos:'admin.aos888.com:9955',fcc:'admin.fcc99.com:9955',cgb:'admin.cgb777.com:9955',goldfun:'admin.goldfun88.com:9955',o9:'admin.o9play.com:9955'};
const keys=Object.keys(HOSTS),finite=v=>typeof v==='number'&&Number.isFinite(v),day=d=>typeof d==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(d)&&Number.isFinite(Date.parse(d))&&new Date(d).toISOString().slice(0,10)===d;
// The first operating month is queried from its known launch date; never rewrite UI proof to day 01.
export const memberMonthStart=(platform,month)=>platform==='win'&&month==='2026-01'?'2026-01-16':month+'-01';
export const validMemberMonthStart=(platform,from)=>day(from)&&(from.endsWith('-01')||platform==='win'&&from==='2026-01-16');
const captureDay=t=>typeof t==='string'&&Number.isFinite(Date.parse(t))?new Date(Date.parse(t)+8*3600000).toISOString().slice(0,10):null;
const span=s=>Array.isArray(s?.period)?{from:s.period[0],through:s.period[1]}:{from:s?.from??s?.period?.from,through:s?.through??s?.period?.through??s?.period?.to};
const newest=items=>[...items].sort((a,b)=>Date.parse(b.capturedAt)-Date.parse(a.capturedAt)||String(a.file).localeCompare(String(b.file)))[0]??null;
const ref=s=>s?{file:s.file,from:s.from,through:s.through,capturedAt:s.capturedAt,sourceUrl:s.sourceUrl,complete:s.complete===true}:null;
function urlOk(value,platform,route){try{const u=new URL(value);return u.protocol==='https:'&&u.host===HOSTS[platform]&&u.pathname.replace(/\/$/,'')===route&&!u.username&&!u.password;}catch{return false;}}
export function parseMemberCreationSource(file,raw,{asOf=currentTaipeiDay()}={}){
 const match=/^members-(win|qz|song|rd|lucky|bo|o8|aos|fcc|cgb|goldfun|o9)-(\d{4}-\d{2}-\d{2})_(\d{4}-\d{2}-\d{2})-asof-(\d{8})\.json$/.exec(file),platform=raw?.platform,period=span(raw),{from,through}=period,q=raw?.queryProof,issues=[],add=v=>{if(!issues.includes(v))issues.push(v);};
 if(!match||platform!==match[1]||from!==match[2]||through!==match[3]||!day(from)||!day(through)||from>through)add('member_filename_or_period_mismatch');
 if(!urlOk(raw?.sourceUrl,platform,'/player/list'))add('member_origin_or_route_invalid');
 const capturedDay=captureDay(raw?.capturedAt);if(!capturedDay||through>=capturedDay||capturedDay>asOf||match?.[4]!==capturedDay?.replaceAll('-',''))add('member_source_not_closed_at_capture');
 if(q?.verified!==true||q.selectedFrom!==from||q.selectedThrough!==through||q.freshResultVerified!==true)add('member_query_unverified');
 const scope=raw?.scope??(/^(?:創辦時間|創帳時間|創建時間)$/.test(q?.selectedRadio||'')?'created_in_period':null);
 if(scope!=='created_in_period'||q?.filtersVerified===false||raw?.filtersProof?.allMembers===false)add('creation_scope_unverified');
 const input=Array.isArray(raw?.rows)?raw.rows:[],header=raw?.header??(Array.isArray(input[0])?input[0]:null),rows=raw?.header||!Array.isArray(input[0])?input:input.slice(1),records=new Map();
 const col=names=>header?.findIndex(v=>names.includes(String(v).trim()))??-1;
 const aidCol=col(['aid','a_id','AID']),createdCol=col(['created','createdAt','registration','創帳時間','創辦時間','創建時間']);
 if(rows.length&&Array.isArray(rows[0])&&(aidCol<0||createdCol<0))add('member_required_columns_missing');
 for(const row of rows){const rawAid=Array.isArray(row)?row[aidCol]:row?.aid??row?.a_id??row?.AID,aid=rawAid==null?'':String(rawAid).trim(),created=String((Array.isArray(row)?row[createdCol]:row?.created??row?.createdAt??row?.registration??row?.['創帳時間'])??''),createdDay=created.slice(0,10);
  if(!aid||typeof rawAid==='number'&&!Number.isSafeInteger(rawAid)||!day(createdDay)||createdDay<from||createdDay>through){add('member_invalid_aid_or_creation');continue;}
  if(records.has(aid)){add('member_duplicate_aid');continue;}records.set(aid,{aid,created:createdDay});
 }
 const rowIssues=issues.length,rowsTrusted=rowIssues===0;
 if(raw?.complete!==true)add('member_source_incomplete');
 if(!Number.isSafeInteger(raw?.totalRows)||raw.totalRows!==rows.length||records.size!==rows.length)add('member_total_rows_mismatch');
 const p=raw?.paginationProof,size=p?.pageSize,total=raw?.totalRows,expectedPages=Number.isSafeInteger(size)&&size>0&&Number.isSafeInteger(total)?Math.max(1,Math.ceil(total/size)):null;
 if(expectedPages===null||p?.totalRows!==total)add('member_pagination_missing');
 else if(Array.isArray(p.pages)){
  if(p.pages.length!==expectedPages)add('member_pagination_missing');
  for(const [i,page]of p.pages.entries())if(page.page!==i+1||(page.rowCount??page.rows)!==Math.min(size,Math.max(0,total-i*size))||i>0&&page.selectedPageVerified!==true)add('member_page_not_verified');
 }else if(p.allPagesRead===true&&p.uniqueAIDs===records.size&&p.pageCount===expectedPages&&Array.isArray(p.pagesRead)&&Array.isArray(p.rowCounts)&&p.pagesRead.length===expectedPages&&p.rowCounts.length===expectedPages){
  for(let i=0;i<expectedPages;i++)if(p.pagesRead[i]!==i+1||p.rowCounts[i]!==Math.min(size,Math.max(0,total-i*size))||i>0&&p.selectedPagesVerified!==true&&p.selectedPageProofs?.[i]?.verified!==true)add('member_page_not_verified');
 }else add('member_pagination_missing');
 if(total===0&&q?.emptyResultVerified!==true)add('member_empty_not_verified');
 return{file,platform,from,through,capturedAt:raw?.capturedAt??null,sourceUrl:raw?.sourceUrl??null,totalRows:Number.isSafeInteger(total)?total:null,records,rowsTrusted,complete:issues.length===0,issues,scope,queryProof:q?{verified:q.verified,selectedFrom:q.selectedFrom,selectedThrough:q.selectedThrough,freshResultVerified:q.freshResultVerified}:null};
}
function registrationFor(registrations,platform,from,through,asOf){
 const list=registrations.filter(r=>r.platform===platform&&r.from===from&&r.through===through&&r.complete===true&&r.validation?.valid===true&&Number.isSafeInteger(r.newRegistered)&&r.newRegistered>=0&&captureDay(r.capturedAt)>through&&captureDay(r.capturedAt)<=asOf),candidate=newest(list);
 return candidate&&new Set(list.filter(r=>Date.parse(r.capturedAt)===Date.parse(candidate.capturedAt)).map(r=>r.newRegistered)).size===1?candidate:null;
}
function dailyAverage(rows,from,through){let dates=[];if(day(from)&&day(through))for(let t=Date.parse(from);t<=Date.parse(through);t+=86400000)dates.push(new Date(t).toISOString().slice(0,10));const a=rows.filter(r=>r[0]>=from&&r[0]<=through);return dates.length&&a.length===dates.length&&new Set(a.map(r=>r[0])).size===a.length&&dates.every(d=>a.some(r=>r[0]===d))&&a.every(r=>finite(r[1]))?a.reduce((s,r)=>s+r[1],0)/a.length:null;}
export function analyzeMemberComposition({rankings=[],memberSources=[],registrationPeriods=[],monthSnapshots=[],daily={},availability={},platforms=keys,asOf=currentTaipeiDay()}={}){
 const allowed=new Set(platforms.filter(k=>keys.includes(k))),months=new Map();
 for(const original of rankings){const rank={...original,capturedAt:original.capturedAt??original.snapshot?.capturedAt},p=rank.period??span(rank.snapshot),platform=rank.platform;if(rank.valid===false||!allowed.has(platform)||!(rank.map instanceof Map)||!day(p.from)||!day(p.through)||!validMemberMonthStart(platform,p.from)||p.from>p.through||p.from.slice(0,7)!==p.through.slice(0,7)||rank.snapshot?.complete!==true||captureDay(rank.capturedAt)<=p.through||!captureDay(rank.capturedAt)||captureDay(rank.capturedAt)>asOf)continue;const positive=[...rank.map.values()].filter(r=>finite(r.cash)&&r.cash>0);if([...rank.map.values()].some(r=>!finite(r.cash)||r.cash<0)||!finite(rank.total)||Math.abs(positive.reduce((s,r)=>s+r.cash,0)-rank.total)>.01)continue;const key=platform+'|'+p.from.slice(0,7),old=months.get(key);if(!old||p.through>old.period.through||p.through===old.period.through&&Date.parse(rank.capturedAt)>Date.parse(old.capturedAt))months.set(key,{...rank,period:p});}
 // Snapshot-only platforms still get explicit missing modules, including
 // competitors whose permission does not expose member-level information.
 for(const m of monthSnapshots)if(allowed.has(m.platform)&&/^\d{4}-\d{2}$/.test(m.month)&&m.month+'-01'<=asOf){const key=m.platform+'|'+m.month;if(!months.has(key))months.set(key,{platform:m.platform,period:{from:memberMonthStart(m.platform,m.month),through:m.through&&m.through<asOf?m.through:(()=>{const closed=new Date(Date.parse(asOf)-86400000).toISOString().slice(0,10);return closed.startsWith(m.month)?closed:null;})()},capturedAt:null,map:null});}
 const currentMonth=asOf.slice(0,7),closedThrough=new Date(Date.parse(asOf)-86400000).toISOString().slice(0,10);
 for(const platform of allowed)if(!months.has(platform+'|'+currentMonth))months.set(platform+'|'+currentMonth,{platform,period:{from:memberMonthStart(platform,currentMonth),through:closedThrough.startsWith(currentMonth)?closedThrough:null},capturedAt:null,map:null});
 const results=[];
 for(const rank of months.values()){
  const platform=rank.platform,{from,through}=rank.period,month=from.slice(0,7),payers=rank.map?[...rank.map.values()].filter(r=>r.cash>0):[],candidates=memberSources.filter(s=>s.platform===platform&&s.from===from&&s.through>=through),completeSources=candidates.filter(s=>s.complete).map(s=>({s,reg:registrationFor(registrationPeriods,platform,s.from,s.through,asOf)})).filter(x=>x.reg&&x.reg.newRegistered===x.s.records.size),firstBest=newest(completeSources.map(x=>x.s)),signature=s=>JSON.stringify([...s.records].sort(([a],[b])=>a.localeCompare(b))),conflict=!!firstBest&&new Set(completeSources.map(x=>x.s).filter(s=>Date.parse(s.capturedAt)===Date.parse(firstBest.capturedAt)).map(signature)).size>1,best=conflict?null:firstBest,observed=conflict?null:best??newest(candidates.filter(s=>s.rowsTrusted)),reg=best?registrationFor(registrationPeriods,platform,best.from,best.through,asOf):null;
  let newCash=0,oldCash=0,unknownCash=0,newCount=0,oldCount=0,unknownCount=0,inconsistent=0;
  for(const r of payers){const known=observed?.records.get(String(r.aid));if(known&&known.created<=through){newCash+=r.cash;newCount++;}else if(best&&!known){oldCash+=r.cash;oldCount++;}else{unknownCash+=r.cash;unknownCount++;if(known&&known.created>through)inconsistent++;}}
  const rankKnown=!!rank.map,verified=rankKnown&&!!best&&inconsistent===0,total=rankKnown?rank.total:null,common={from,through,source:rankKnown?'完整儲值排行 × 創帳 AID 名單':'完整儲值排行與創帳名單待補',rankSource:rank.file??null,memberSource:observed?.file??null,registrationSource:reg?.file??null,capturedAt:rank.capturedAt,sourceFiles:[rank.file,observed?.file,reg?.file].filter(Boolean),complete:verified,verified,classificationMethod:verified?'complete_current_registration_cohort_exclusion':'observed_creation_matches_only',unknownReason:verified?null:!rankKnown?'payer_ranking_missing':!observed?'creation_aid_source_missing':!best?'creation_cohort_not_reconciled':'creation_after_paid_period'};
  const deposit={...common,total,newRegistered:rankKnown?newCash:null,existing:rankKnown?oldCash:null,unknown:rankKnown?unknownCash:null},paidMembers={...common,total:rankKnown?payers.length:null,newRegistered:rankKnown?newCount:null,existing:rankKnown?oldCount:null,unknown:rankKnown?unknownCount:null};
  const snapshot=newest(monthSnapshots.filter(m=>m.platform===platform&&m.month===month)),mau={from,through:snapshot?.through??through,total:finite(snapshot?.mau)?snapshot.mau:null,newRegistered:null,existing:null,unknown:null,complete:false,verified:false,source:'後台月活躍總量；創帳 × 期間登入交集尚未取得',capturedAt:snapshot?.capturedAt??null,sourceFiles:[],unknownReason:'login_aid_intersection_missing',partial:snapshot?.partial===true},dauTotal=dailyAverage(daily[platform]??[],from,through),dau={from,through,total:dauTotal,newRegistered:null,existing:null,unknown:null,complete:false,verified:false,source:'完整日報日均 DAU；缺逐日登入 AID 與創帳交集',unknownReason:'daily_login_aid_intersection_missing',sourceFiles:[]};
  const monthEnd=new Date(Date.UTC(Number(month.slice(0,4)),Number(month.slice(5)),0)).toISOString().slice(0,10),requestedThrough=monthEnd<closedThrough?monthEnd:closedThrough.startsWith(month)?closedThrough:null;
  const gaps=[];if(requestedThrough&&rankKnown&&through<requestedThrough)gaps.push('payer_ranking_older_than_target');if(conflict)gaps.push('conflicting_creation_snapshots');if(!rankKnown)gaps.push('payer_ranking_missing');if(!observed)gaps.push('creation_aid_source_missing');if(observed&&!best)gaps.push('creation_cohort_not_reconciled');if(inconsistent)gaps.push('creation_after_paid_period');gaps.push('login_aid_intersection_missing','daily_login_aid_intersection_missing');
  results.push({schema:1,platform,month,from,through,periodCoverage:from==='2026-01-16'&&platform==='win'?'known_launch_month':'calendar_month_start',requestedThrough,verified,availability:availability[platform]?{state:availability[platform].state??null,message:availability[platform].message??null,confirmedOn:availability[platform].confirmedOn??null}:null,metrics:{deposit,paidMembers,mau,dau},cohortCoverage:{complete:!!best,uniqueAIDs:observed?.records.size??null,registrationCount:reg?.newRegistered??null,memberFrom:observed?.from??null,memberThrough:observed?.through??null,queryScope:observed?.scope??null},sources:[ref(observed),reg?{file:reg.file,from:reg.from,through:reg.through,capturedAt:reg.capturedAt,complete:true}:null,rankKnown?{file:rank.file,from,through,capturedAt:rank.capturedAt,complete:true}:null].filter(Boolean),gaps,sourceIssues:candidates.filter(s=>s.issues.length).map(s=>({file:s.file,issues:s.issues})),definitions:{new:'當月註冊且於所列期間官儲的會員；不是首次付費者。',existing:'僅在完整當月新註冊 AID 母體已對平後，才將排行中其餘會員歸為此前註冊。',unknown:'未符合完整度或創帳數核對時，未匹配會員保持待分類。',activity:'不以最後登入快照、註冊人數或付費會員推估 MAU／DAU 的新舊交集。'}});
 }
 return results.sort((a,b)=>keys.indexOf(a.platform)-keys.indexOf(b.platform)||a.month.localeCompare(b.month));
}
export async function buildMemberComposition(liveDir,{data={},asOf=currentTaipeiDay(),rankings=null,registrationPeriods=null,platforms=keys}={}){
 const files=await fs.readdir(liveDir),members=[];
 for(const file of files.filter(f=>/^members-(win|qz|song|rd|lucky|bo|o8|aos|fcc|cgb|goldfun|o9)-.*-asof-\d{8}\.json$/.test(f)))try{members.push(parseMemberCreationSource(file,JSON.parse((await fs.readFile(path.join(liveDir,file),'utf8')).replace(/^\uFEFF/,'')),{asOf}));}catch{members.push({file,platform:null,complete:false,rowsTrusted:false,records:new Map(),issues:['member_json_unreadable']});}
 let ranks=rankings;if(ranks===null){const {loadRankingSources}=await import('./detail-source-selection.mjs'),loaded=await loadRankingSources(liveDir,{dailyByPlatform:data.daily,today:asOf});ranks=[...(loaded.selected??[]),...(loaded.comparisonSources??[])];}
 const registrations=[...(registrationPeriods??data.registrationPeriods??await buildOwnedRegistrationPeriods(liveDir,{today:asOf})),...await buildRegistrationPeriods(liveDir,{today:asOf})],snapshots=[...(data.monthSnapshots??[])],daily={...(data.daily??{})};
 for(const c of data.competitors??[]){if(!keys.includes(c.key))continue;snapshots.push(...(c.normalizedMonthly??[]).map(r=>({...r,platform:c.key})));daily[c.key]=c.normalizedDaily??daily[c.key]??[];
  for(const [name,r]of Object.entries(c.newRegistrations??{})){const p=span(r),q=r.queryProof;if(q?.verified===true&&q.selectedFrom===p.from&&q.selectedThrough===p.through&&urlOk(r.sourceUrl,c.key,'/statements/player-view'))registrations.push({platform:c.key,...p,newRegistered:r.newRegistered,capturedAt:r.capturedAt,complete:true,validation:{valid:true},file:`competitor-observations.json#${c.key}.newRegistrations.${name}`});}
 }
 return analyzeMemberComposition({rankings:ranks,memberSources:members,registrationPeriods:registrations,monthSnapshots:snapshots,daily,availability:Object.fromEntries((data.platforms??[]).filter(p=>p.availability).map(p=>[p.key,p.availability])),platforms,asOf});
}
