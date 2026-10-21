import {PRIVATE_ROSTERS} from './private-rosters.mjs';
import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {parseCompetitorNetworkSource,analyzeCompetitorMerchantNetworks} from './competitor-merchant-network.mjs';
import {normalizeDaily,splitTodayProgress,currentTaipeiDay} from './backend-metrics.mjs';
import {convertCoins,loadCoinConversionPolicy} from './coin-conversion.mjs';

const SITES={o8:{name:'發又發',host:'admin.8o8.tw:9955'},aos:{name:'黑桃A',host:'admin.aos888.com:9955'},fcc:{name:'財哥',host:'admin.fcc99.com:9955'},cgb:{name:'超吉爆',host:'admin.cgb777.com:9955'},goldfun:{name:'金來快',host:'admin.goldfun88.com:9955'},o9:{name:'黑狗兄',host:'admin.o9play.com:9955'}};
export const COMPETITOR_SCENARIO_MODEL_VERSION='fixed-network-candidates-2026-10-20-v1';
// This is an explicit, reproducible hypothesis roster, never an identity registry.
// Holding it constant across both periods avoids attributing roster changes to sales.
export const COMPETITOR_SCENARIO_ROSTER=Object.freeze(PRIVATE_ROSTERS.candidates);
const EXCLUDED_ROLES=PRIVATE_ROSTERS.excludedRoles;
const validDate=s=>typeof s==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(s)&&Number.isFinite(Date.parse(s))&&new Date(s).toISOString().slice(0,10)===s;
const day=t=>typeof t==='string'&&Number.isFinite(Date.parse(t))?new Date(Date.parse(t)+8*3600000).toISOString().slice(0,10):null;
const finite=v=>typeof v==='number'&&Number.isFinite(v)?v:null;
const integer=v=>typeof v==='number'?Number.isSafeInteger(v)?v:null:/^\d+$/.test(String(v??''))?Number(v):null;
function dates(from,through){const out=[];if(!validDate(from)||!validDate(through)||from>through)return out;for(let t=Date.parse(from);t<=Date.parse(through);t+=86400000)out.push(new Date(t).toISOString().slice(0,10));return out;}
function previousWindow(current){const t=new Date(current.from+'T00:00:00Z');t.setUTCMonth(t.getUTCMonth()-1);const month=t.toISOString().slice(0,7),last=new Date(Date.UTC(t.getUTCFullYear(),t.getUTCMonth()+1,0)).getUTCDate();return{from:month+'-01',through:month+'-'+String(Math.min(last,Number(current.through.slice(8)))).padStart(2,'0')};}
const hash=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');

export function parseCompetitorFundingSource(file,data){
 const m=/^competitor-period-rank-(o8|aos|fcc|cgb|goldfun|o9)-(\d{4}-\d{2}-\d{2})_(\d{4}-\d{2}-\d{2})\.json$/.exec(file),platform=m?.[1]??data?.platform,from=m?.[2]??data?.from,through=m?.[3]??data?.through;
 const parsed=parseCompetitorNetworkSource(`gift-network-week-${platform}-${from}_${through}.json`,data),issues=[...parsed.issues],add=issue=>{if(!issues.includes(issue))issues.push(issue);};
 if(!m)add('unsupported_period_filename');if(from?.slice(8)!=='01'||from?.slice(0,7)!==through?.slice(0,7))add('requires_same_month_start_day_one');
 if(data?.recentOnlyRestriction!==false)add('monthly_access_not_independently_verified');
 const p=data?.paginationProof,reported=integer(data?.totalRows),pageSize=integer(p?.pageSize),proofTotal=integer(p?.totalRows),pages=p?.pages;
 if(pageSize===null||pageSize<=0||reported===null||proofTotal!==reported||!Array.isArray(pages))add('pagination_proof_missing_or_invalid');
 else{
  const expected=Math.max(1,Math.ceil(reported/pageSize));if(pages.length!==expected)add('pagination_page_count_mismatch');
  let sum=0;for(let i=0;i<pages.length;i++){const page=pages[i],count=integer(page.rowCount),first=integer(page.firstRank),last=integer(page.lastRank),expectedCount=Math.min(pageSize,Math.max(0,reported-i*pageSize));
   if(integer(page.page)!==i+1||count!==expectedCount)add('pagination_sequence_or_row_count_mismatch');
   const local=page.rankMode==='page-local',rankStart=local?1:i*pageSize+1;
   if(local&&i>0&&page.selectedPageVerified!==true)add('page_local_selection_not_verified');
   if(expectedCount>0&&(first!==rankStart||last!==rankStart+expectedCount-1))add('pagination_rank_range_mismatch');
   const rows=data.rows?.slice(i*pageSize,i*pageSize+expectedCount),rankColumn=Array.isArray(data.header)?data.header.indexOf('名次'):-1;
   if(rankColumn<0||!Array.isArray(rows)||rows.length!==expectedCount||rows.some((r,j)=>integer(r[rankColumn])!==rankStart+j))add('source_rank_sequence_mismatch');
   sum+=count??0;
  }if(sum!==reported)add('pagination_row_sum_mismatch');
 }
 return{...parsed,file,kind:'competitor_period_ranking',complete:issues.length===0,issues,paginationProof:p?structuredClone(p):null};
}

function sourceMeta(s){return s?{file:s.file,sourceUrl:s.sourceUrl,capturedAt:s.capturedAt,captureDate:s.captureDate,from:s.from,through:s.through,complete:s.complete,partial:s.partial,dateProofVerified:s.dateProofVerified,rowCount:s.rowCount,totalRows:s.totalRows,paginationProof:s.paginationProof,issues:s.issues,validation:s.validation}:null;}
export function parseCompetitorCashSource(file,data){
 const m=/^competitor-cash-range-(o8|aos|fcc|cgb|goldfun|o9)-(\d{4}-\d{2}-\d{2})_(\d{4}-\d{2}-\d{2})\.json$/.exec(file),platform=m?.[1]??data?.platform,from=m?.[2]??data?.from,through=m?.[3]??data?.through,issues=[];
 if(!m||data?.platform!==platform||data?.from!==from||data?.through!==through||!validDate(from)||!validDate(through)||from>through)issues.push('cash_filename_or_period_mismatch');
 const p=data?.queryProof;if(p?.verified!==true||p.selectedFrom!==from||p.selectedThrough!==through)issues.push('cash_selected_dates_not_verified');
 if(data?.complete!==true||data?.tab!=='玩家消費')issues.push('cash_report_incomplete_or_wrong_tab');
 let rows=[];try{rows=normalizeDaily(data);}catch{issues.push('cash_duplicate_or_invalid_dates');}
 if(!rows.length&&dates(from,through).length)issues.push('cash_daily_rows_missing');
 if(rows.some(r=>r[0]<from||r[0]>through))issues.push('cash_rows_outside_selected_period');
 return{file,platform,from,through,rows,capturedAt:data?.capturedAt??null,sourceUrl:data?.sourceUrl??null,queryProof:p?structuredClone(p):null,validation:{valid:issues.length===0,issues}};
}
function cashWindow(platform,period,sources,asOf){
 const source=(Array.isArray(sources)?sources:[sources]).filter(Boolean).filter(s=>!s.from||(s.from<=period.from&&s.through>=period.through)).sort((a,b)=>Number(b.from===period.from&&b.through===period.through)-Number(a.from===period.from&&a.through===period.through)||Date.parse(b.capturedAt)-Date.parse(a.capturedAt))[0];
 const issues=[],expected=dates(period.from,period.through),capturedAt=source?.capturedAt??null,sourceUrl=source?.sourceUrl??null;
 if(source?.validation?.valid===false)issues.push(...source.validation.issues);
 try{const u=new URL(sourceUrl);if(u.protocol!=='https:'||u.host!==SITES[platform].host||u.pathname.replace(/\/$/,'')!=='/statements/player-summary'||u.username||u.password)issues.push('untrusted_cash_source');}catch{issues.push('cash_source_missing');}
 let closed=[];try{closed=splitTodayProgress(source?.rows??[],{capturedAt},asOf).daily;}catch{issues.push('invalid_or_duplicate_cash_dates');}
 const byDate=new Map(closed.map(r=>[r[0],r[4]])),missingDates=expected.filter(d=>finite(byDate.get(d))===null||byDate.get(d)<0);
 if(!expected.length)issues.push('invalid_cash_period');if(missingDates.length)issues.push('cash_period_not_complete');
 return{value:issues.length?null:expected.reduce((sum,d)=>sum+byDate.get(d),0),source:{file:source?.file??null,capturedAt,sourceUrl,from:period.from,through:period.through,queryProof:source?.queryProof??null,complete:issues.length===0,missingDates,issues,closureDefinition:'日期須早於本來源capturedAt台灣日；不把前日未結快照自動升完整。'}};
}

function periodScenario(platform,period,source,roster,excludedRoles,cashSource,policy,asOf,rosterVersion){
 const identities=new Set(roster.map(r=>String(r.aid))),excluded=new Set(excludedRoles.map(r=>r.aid)),cash=cashWindow(platform,period,cashSource,asOf);
 let observedBuyCoins=null,observedSellCoins=null,excludedInternalCoins=null,excludedInternalPairs=null,excludedRoleCoins=null,excludedRolePairs=null;
 if(source?.complete&&roster.length){observedBuyCoins=0;observedSellCoins=0;excludedInternalCoins=0;excludedInternalPairs=0;excludedRoleCoins=0;excludedRolePairs=0;
  for(const e of source.edges.values()){
   if(e.fromAid===e.toAid)continue;
   if(excluded.has(e.fromAid)||excluded.has(e.toAid)){excludedRoleCoins+=e.coins;excludedRolePairs++;continue;}
   const from=identities.has(e.fromAid),to=identities.has(e.toAid);
   if(from&&to){excludedInternalCoins+=e.coins;excludedInternalPairs++;}else if(from)observedBuyCoins+=e.coins;else if(to)observedSellCoins+=e.coins;
  }
 }
 const issues=source?[...source.issues]:['period_source_missing'];if(source?.partial)issues.push('source_contains_unclosed_day');if(!roster.length)issues.push('scenario_roster_missing');
 if(source?.captureDate>asOf)issues.push('capture_after_analysis_day');
 const covered=!!source?.complete&&roster.length>0&&!source.partial&&!(source.captureDate>asOf),buyCoins=covered?observedBuyCoins:null,sellCoins=covered?observedSellCoins:null;
 const buyAmount=convertCoins(buyCoins,platform,'buy',policy),sellAmount=convertCoins(sellCoins,platform,'sell',policy),scenarioRevenue=cash.value!==null&&buyAmount!==null&&sellAmount!==null?cash.value+buyAmount-sellAmount:null;
 return{...period,capturedAt:source?.capturedAt??null,partial:source?.partial??null,covered,buyCoins,sellCoins,observedBuyCoins,observedSellCoins,buyAmount,sellAmount,officialCash:cash.value,scenarioRevenue,officialRevenue:null,includeInActualRevenue:false,buyDivisor:finite(policy?.rates?.[platform]?.buyDivisor),sellDivisor:finite(policy?.rates?.[platform]?.sellDivisor),excludedInternalCoins,excludedInternalPairs,excludedRoleCoins,excludedRolePairs,sourceFiles:source?[source.file]:[],sourceUrl:source?.sourceUrl??null,source:sourceMeta(source),cashSource:cash.source,rosterVersion,validation:{valid:covered,issues:[...new Set(issues)]}};
}

function compare(previous,current){
 const previousDays=dates(previous.from,previous.through).length,currentDays=dates(current.from,current.through).length,comparable=previous.covered&&current.covered&&previousDays===currentDays&&previous.rosterVersion===current.rosterVersion;
 const cashComparable=previousDays===currentDays&&previous.cashSource.complete&&current.cashSource.complete&&finite(previous.officialCash)!==null&&finite(current.officialCash)!==null;
 const revenueComparable=comparable&&cashComparable&&finite(previous.scenarioRevenue)!==null&&finite(current.scenarioRevenue)!==null;
 const out={comparable,cashComparable,revenueComparable,reason:comparable?'固定候選名單、兩期完整同日數來源；僅比較假設口徑':'幣流日期、完整度或固定候選名單未對齊；官儲若獨立完整仍可比較'};
 for(const field of ['buyCoins','sellCoins','buyAmount','sellAmount','scenarioRevenue'])out[field]=comparable&&finite(previous[field])!==null&&finite(current[field])!==null?current[field]-previous[field]:null;
 out.officialCash=cashComparable?current.officialCash-previous.officialCash:null;out.cashRate=cashComparable&&previous.officialCash!==0?current.officialCash/previous.officialCash-1:null;
 const rate=field=>comparable&&finite(previous[field])!==null&&previous[field]!==0&&finite(current[field])!==null?current[field]/previous[field]-1:null;
 out.buyRate=rate('buyAmount');out.sellRate=rate('sellAmount');out.scenarioRevenueRate=previous.scenarioRevenue>0?rate('scenarioRevenue'):null;return out;
}

export function analyzeCompetitorFunding(reports,{cashSources={},policy={},asOf=currentTaipeiDay(),currentPeriod=null,candidateRoster=COMPETITOR_SCENARIO_ROSTER}={}){
 if(!validDate(asOf))throw Error('asOf must be ISO calendar date');
 const parsed=reports.map(r=>parseCompetitorFundingSource(r.file,r.data));
 const mostRecent=parsed.filter(s=>validDate(s.from)&&validDate(s.through)&&s.from.slice(0,7)===asOf.slice(0,7)&&s.through<=asOf).sort((a,b)=>b.through.localeCompare(a.through))[0];
 const yesterday=new Date(Date.parse(asOf)-86400000).toISOString().slice(0,10),current=currentPeriod??(mostRecent?{from:mostRecent.from,through:mostRecent.through}:{from:yesterday.slice(0,7)+'-01',through:yesterday});
 if(!validDate(current.from)||!validDate(current.through)||current.from.slice(8)!=='01'||current.from.slice(0,7)!==current.through.slice(0,7)||current.from>current.through)throw Error('invalid current scenario period');
 const previous=previousWindow(current),platforms=[];
 for(const [platform,site] of Object.entries(SITES)){
  const excludedRoles=structuredClone(EXCLUDED_ROLES[platform]??[]),excluded=new Set(excludedRoles.map(r=>r.aid)),roster=(candidateRoster[platform]??[]).filter(r=>!excluded.has(String(r.aid))).map(r=>({...r,aid:String(r.aid),verified:false,identityStatus:'unconfirmed_network_candidate'}));
  if(new Set(roster.map(r=>r.aid)).size!==roster.length)throw Error('duplicate platform-scoped scenario AID');
  const rosterVersion=COMPETITOR_SCENARIO_MODEL_VERSION+':'+hash(roster.map(r=>r.aid).sort()).slice(0,16);
  const get=p=>parsed.filter(s=>s.platform===platform&&s.from===p.from&&s.through===p.through).sort((a,b)=>String(b.capturedAt).localeCompare(String(a.capturedAt)))[0]??null,previousSource=get(previous),currentSource=get(current);
  const prior=periodScenario(platform,previous,previousSource,roster,excludedRoles,cashSources[platform],policy,asOf,rosterVersion),now=periodScenario(platform,current,currentSource,roster,excludedRoles,cashSources[platform],policy,asOf,rosterVersion);
  // Independent per-period graph screening is retained for review, not silently
  // added to the fixed comparison cohort or to the confirmed identity registry.
  const graphs=[previousSource,currentSource].map(s=>s?.complete?analyzeCompetitorMerchantNetworks([{file:`gift-network-week-${platform}-${s.from}_${s.through}.json`,data:reports.find(r=>r.file===s.file)?.data}],{asOf}).platforms.find(p=>p.platform===platform)?.candidates??[]:[]);
  const selectedIds=new Set(roster.map(r=>r.aid)),additional=new Map();for(let i=0;i<graphs.length;i++)for(const c of graphs[i])if(!selectedIds.has(c.aid)&&!excluded.has(c.aid)){const a=additional.get(c.aid)??{aid:c.aid,nickname:c.nickname,observedPeriods:[],classifications:[],observations:[],verified:false,includedInScenario:false};a.observedPeriods.push(i?'current':'previous');a.classifications.push(c.classificationLabel);a.observations.push({period:i?'current':'previous',from:i?current.from:previous.from,through:i?current.through:previous.through,classification:c.classification,weekly:c.weekly,evidence:c.evidence,counterEvidence:c.counterEvidence});additional.set(c.aid,a);}
  platforms.push({platform,name:site.name,status:roster.length?'candidate_identity_scenario':'missing_roster',modelVersion:COMPETITOR_SCENARIO_MODEL_VERSION,rosterVersion,includedMerchants:roster,excludedRoles,previous:prior,current:now,change:compare(prior,now),possibleAdditionalCandidates:[...additional.values()].map(c=>({...c,seenInBothPeriods:c.observedPeriods.length===2})),officialRevenue:null,includeInActualRevenue:false});
 }
 return{schema:1,modelVersion:COMPETITOR_SCENARIO_MODEL_VERSION,generatedAt:new Date().toISOString(),asOf,timezone:'Asia/Taipei',platforms,definitions:{identity:'固定原22個交易網路候選作情境，不是已確認幣商。兩期使用同一平台+AID名單，新增圖形線索另列，不自動擴名單。',direction:'單向from→to原始贈禮金額一次；反向是另一條邊，差額僅驗證。不含候選間互轉、自己轉自己，使用者確認直播主角色之往來亦從本次未驗證幣商情境排除；不代表已證明其不兼營幣商。',scenario:'情境營收＝同期後台官儲＋候選對外贈幣÷指定買比率－外部贈予候選÷指定賣比率；抽成、成交現金、補幣與沖正未驗，非實際營收或淨利。',coverage:'日期proof、完整逐頁排行、採集日期與閉日、官儲逐日各自驗證；不完整為null，完整且無交易才是0。',comparison:'同日數、同名單比較；未結日及缺資料不作幅度。缺上月同期不能用本週外推。',uncertainty:'誤納與漏納候選均可能使結果偏高或偏低，試算不是營收上下界，不納正式營收。',rates:'沿用使用者指定coins/divisor；未確認歷史生效日期，原始金幣保留，無比率不換算。',units:'原始金幣只在同站比較，不跨站相加。'}};
}

export async function buildCompetitorFunding(liveDir,{competitors=null,policy=null,...options}={}){
 const reports=[],sourceReadErrors=[];
 for(const file of (await fs.readdir(liveDir)).filter(f=>/^competitor-period-rank-(o8|aos|fcc|cgb|goldfun|o9)-.*\.json$/.test(f)).sort())try{reports.push({file,data:JSON.parse((await fs.readFile(path.join(liveDir,file),'utf8')).replace(/^\uFEFF/,''))});}catch{sourceReadErrors.push({file,issue:'source_json_unreadable'});}
 if(competitors===null)try{const raw=JSON.parse((await fs.readFile(path.join(liveDir,'competitor-observations.json'),'utf8')).replace(/^\uFEFF/,''));competitors=Array.isArray(raw)?raw:raw.competitors??[];}catch(error){if(error.code!=='ENOENT')throw error;competitors=[];}
 const cashSources={};for(const c of competitors??[]){const raw=c.consumeDaily;cashSources[c.key]=[{rows:normalizeDaily(raw),capturedAt:raw?.capturedAt??c.capturedAt,sourceUrl:raw?.sourceUrl??c.url+'statements/player-summary'}];}
 for(const file of (await fs.readdir(liveDir)).filter(f=>/^competitor-cash-range-(o8|aos|fcc|cgb|goldfun|o9)-.*\.json$/.test(f)).sort())try{const raw=JSON.parse((await fs.readFile(path.join(liveDir,file),'utf8')).replace(/^\uFEFF/,'')),source=parseCompetitorCashSource(file,raw);(cashSources[source.platform]??=[]).push(source);}catch{sourceReadErrors.push({file,issue:'cash_source_json_unreadable'});}
 const result={...analyzeCompetitorFunding(reports,{...options,cashSources,policy:policy??await loadCoinConversionPolicy()}),sourceReadErrors};
 try{const access=JSON.parse(await fs.readFile(path.join(liveDir,'competitor-history-access-20261021.json'),'utf8'));for(const group of result.platforms){const r=access.restrictions?.find(r=>r.platform===group.platform&&r.result==='blocked'&&typeof r.message==='string'&&Number.isFinite(Date.parse(r.capturedAt)));if(!r)continue;const u=new URL(r.sourceUrl);if(u.protocol==='https:'&&u.host===SITES[group.platform]?.host&&!u.username&&!u.password)group.historyAccess={platform:r.platform,sourceUrl:u.href,from:r.from,through:r.through,result:'blocked',message:r.message,capturedAt:r.capturedAt,complete:false};}}catch(error){if(error.code!=='ENOENT')sourceReadErrors.push({file:'competitor-history-access-20261021.json',issue:'history_access_metadata_unreadable'});}
 return result;
}
