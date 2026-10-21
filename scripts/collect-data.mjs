import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {buildMerchantCandidates} from './merchant-candidates.mjs';
import {buildCompetitorMerchantNetwork} from './competitor-merchant-network.mjs';
import {buildCompetitorFunding} from './competitor-funding.mjs';
import {buildCompetitorArchives} from './competitor-archive.mjs';
import {buildCompetitorRoleEvidence,applyConfirmedCompetitorRoles} from './competitor-role-evidence.mjs';
import {buildMachineData} from './machine-data.mjs';
import {buildQualityAudit} from './quality-audit.mjs';
import {buildPayments} from './payment-structure.mjs';
import {buildOwnedCashSources,mergeOwnedCashSources,ownedCashEvidence} from './owned-cash-data.mjs';
import {buildMarketFundingComparisons} from './market-funding-comparisons.mjs';
import {buildOwnedRegistrationPeriods} from './owned-registration-data.mjs';
import {buildMonthlyReports} from './monthly-report.mjs';
import {buildMarketDailyComparisons} from './market-daily-comparisons.mjs';
import {buildBackendMetrics,normalizeDaily,splitTodayProgress,currentTaipeiDay} from './backend-metrics.mjs';
import {buildChannels} from './channel-data.mjs';
import {buildCohortData} from './cohort-data.mjs';
import {buildMemberComposition} from './member-composition-data.mjs';
import {buildCurrentChannels} from './current-channel-data.mjs';
import {buildDetailRefreshStatus} from './detail-refresh-status.mjs';
import {buildHistoryProgress} from './history-progress-data.mjs';
import {buildTodayProgressSources,applyTodayProgressSources} from './today-progress-data.mjs';
import {buildPromotionPackageData} from './promotion-package-data.mjs';
import {loadCoinConversionPolicy,buildMerchantFunding,CONVERSION_DEFINITION,REVENUE_DEFINITION} from './coin-conversion.mjs';
export const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
export const ops='C:/Users/User/Documents/Codex/2026-09-18/new-chat/outputs/operations-program';
const live='C:/Users/User/Documents/ChatGPT/outputs/01a15831-ccf2-7fc3-bbe2-813c2cd1dc71/live-data';
const read=async p=>JSON.parse((await fs.readFile(p,'utf8')).replace(/^\uFEFF/,''));
export const platforms=[{key:'win',name:'贏麻了',launchDate:'2026-01-16',launchDateSource:'使用者提供',col:'I',reg:'AI',url:'https://admin.winmalo.com:9955/'},{key:'qz',name:'茄子',col:'E',reg:'AE',url:'https://admin.qzplays.com:9955/'},{key:'song',name:'爽爆',col:'D',reg:'AD',url:'https://admin.song-yy.com:9955/'},{key:'rd',name:'紅鑽',col:'F',reg:'AF',url:'https://admin.rdplays.com:9955/'},{key:'lucky',name:'來好運',col:'G',reg:'AG',url:'https://admin.lylucky.com:9955/'},{key:'bo',name:'來博',col:'C',reg:'AC',url:'https://admin.lybobet.com:9955/'}];
// Evaluate the small arithmetic subset actually used by the saved report. Never execute a formula.
export function cellValue(book,sheet,addr,seen=new Set()){
 const key=sheet+'!'+addr;if(seen.has(key))return null;seen=new Set(seen).add(key);
 const raw=book[sheet]?.cells?.[addr]?.value;if(typeof raw==='number')return Number.isFinite(raw)?raw:null;if(raw==null||raw==='')return null;
 if(typeof raw!=='string'||!raw.startsWith('='))return /^-?\d+(\.\d+)?$/.test(String(raw))?Number(raw):null;
 let s=raw.slice(1).replace(/'([^']+)'!([A-Z]+\d+)/g,(_,sh,a)=>{const v=cellValue(book,sh,a,seen);return v===null?'?':String(v)});
 s=s.replace(/\b([A-Z]+\d+)\b/g,(_,a)=>{const v=cellValue(book,sheet,a,seen);return v===null?'?':String(v)});
 if(!/^[\d.\s+*/()\-]+$/.test(s))return null;
 const tokens=s.match(/\d+(?:\.\d+)?|[()+*/-]/g)||[];let i=0;
 const atom=()=>{let t=tokens[i++];if(t==='-')return -atom();if(t==='+')return atom();if(t==='('){let v=expr();if(tokens[i++]!==')')throw Error();return v;}if(!/^\d/.test(t||''))throw Error();return Number(t);};
 const term=()=>{let v=atom();while(tokens[i]==='*'||tokens[i]==='/'){let op=tokens[i++],n=atom();v=op==='*'?v*n:v/n;}return v;};
 const expr=()=>{let v=term();while(tokens[i]==='+'||tokens[i]==='-'){let op=tokens[i++],n=term();v=op==='+'?v+n:v-n;}return v;};
 try{let v=expr();return i===tokens.length&&Number.isFinite(v)?v:null;}catch{return null;}
}
export function sameDays(rows,month,days){return rows.filter(r=>r[0].startsWith(month)&&Number(r[0].slice(8))<=days);}
export function monthlyCoverage(platform,month,observedDates,today=currentTaipeiDay()){
 const last=new Date(Number(month.slice(0,4)),Number(month.slice(5)),0).getDate(),end=month+'-'+String(last).padStart(2,'0');
 const launchAdjusted=platform.launchDate?.slice(0,7)===month,from=launchAdjusted?platform.launchDate:month+'-01';
 const expected=[];for(let t=Date.parse(from+'T00:00:00Z');t<=Date.parse(end+'T00:00:00Z');t+=86400000)expected.push(new Date(t).toISOString().slice(0,10));
 const present=new Set(observedDates);
 return {expectedFrom:from,expectedThrough:end,expectedDays:expected.length,launchAdjusted:!!launchAdjusted,missingDates:expected.filter(d=>d<today&&!present.has(d)),complete:expected.length>0&&expected.every(d=>present.has(d))};
}
export function backendDailySources(raw){
 const out=[];
 if(Array.isArray(raw.daily))out.push({rows:raw.daily,capturedAt:raw.dailyCapturedAt??raw.capturedAt,sourceUrl:raw.sourceUrl});
 const consume=raw.consumeDaily??raw.tables?.consumeDaily;
 if(consume)out.push({rows:normalizeDaily(consume),capturedAt:consume.capturedAt??raw.capturedAt,sourceUrl:consume.sourceUrl??raw.sourceUrl});
 return out;
}
export async function collect(){
 const today=currentTaipeiDay(),currentMonth=today.slice(0,7),todayProgress=[];
 const runs=path.join(ops,'private/runs');const dirs=(await fs.readdir(runs,{withFileTypes:true})).filter(x=>x.isDirectory()&&/^20/.test(x.name)).map(x=>x.name).sort();
 const latest={};const history={win:new Map(),qz:new Map(),song:new Map()};const historyTime={win:new Map(),qz:new Map(),song:new Map()};
 // Snapshots are upserted by date, in run order; missing days never turn into zeroes.
 for(const dir of dirs){for(const p of platforms.filter(p=>history[p.key])){try{const source=await read(path.join(runs,dir,p.key+'-source.json'));const runCapture=dir.replace(/T(\d\d)-(\d\d)-(\d\d)-(\d{3})Z/,'T$1:$2:$3.$4Z');const capturedAt=source.dailyCapturedAt??source.capturedAt??runCapture,stamp=Date.parse(capturedAt);for(const row of splitTodayProgress(source.daily||[],{capturedAt},today).daily){history[p.key].set(row[0],row);historyTime[p.key].set(row[0],stamp);}latest[p.key]={run:dir,source};}catch(e){if(e.code!=='ENOENT')throw e;}}}
 const monthly=[];const backendHistory={};
 for(const p of platforms){try{const h=await read(live+'/backend-history-'+p.key+'.json');backendHistory[p.key]=h;history[p.key]??=new Map();historyTime[p.key]??=new Map();
  for(const source of backendDailySources(h)){const stamp=Date.parse(source.capturedAt);for(const row of splitTodayProgress(source.rows,source,today).daily)if(stamp>=(historyTime[p.key].get(row[0])??0)){history[p.key].set(row[0],row);historyTime[p.key].set(row[0],stamp);}}
  const consume=h.consumeDaily??h.tables?.consumeDaily;
  const progress=splitTodayProgress(consume?normalizeDaily(consume):[],{platform:p.key,dailyToday:h.dailyToday,capturedAt:consume?.capturedAt??h.capturedAt,sourceUrl:consume?.sourceUrl??h.sourceUrl??p.url},today).todayProgress;
  if(progress)todayProgress.push(progress);
 }catch(e){if(e.code!=='ENOENT')throw e;}}
 const ownedCashSources=await buildOwnedCashSources(live,{today});
 mergeOwnedCashSources(history,historyTime,ownedCashSources);
 for(const source of ownedCashSources)if(source.todayProgress&&!todayProgress.some(row=>row.platform===source.platform))todayProgress.push(source.todayProgress);
 const daily=Object.fromEntries(Object.entries(history).map(([k,v])=>[k,[...v.values()].filter(row=>row[0]<today).sort((a,b)=>a[0].localeCompare(b[0]))]));
 for(const p of platforms){const rows=daily[p.key]||[],months=[...new Set(rows.map(r=>r[0].slice(0,7)))];for(const month of months){const a=rows.filter(r=>r[0].startsWith(month)),coverage=monthlyCoverage(p,month,a.map(r=>r[0]),today);monthly.push({platform:p.key,month,reportDeposit:a.reduce((s,r)=>s+r[4],0),registrations:null,dau:a.reduce((s,r)=>s+r[1],0)/a.length,payerDays:a.reduce((s,r)=>s+r[2],0),firstPayers:a.reduce((s,r)=>s+(typeof r[8]==='number'?r[8]:0),0),days:a.length,through:a.at(-1)[0],...coverage,partial:month===currentMonth,source:'後台日報逐日加總',sourceUrl:p.url+'statements/player-summary',sourceRun:backendHistory[p.key]?.capturedAt||latest[p.key]?.run});}}
 // Registration dates are taken from backend retention cohorts, never the weekly workbook.
 const retention={};for(const p of platforms){const merged=new Map(),saved=backendHistory[p.key],run=latest[p.key],runTime=Date.parse((run?.run||'').replace(/T(\d\d)-(\d\d)-(\d\d)-(\d{3})Z/,'T$1:$2:$3.$4Z'));const sets=Date.parse(saved?.registrationSource?.capturedAt||saved?.capturedAt||'')>=runTime?[run?.source.retention,saved?.retention]:[saved?.retention,run?.source.retention];for(const rows of sets)for(const r of rows||[])merged.set(r[0],r);retention[p.key]=[...merged.values()].sort((a,b)=>a[0].localeCompare(b[0]));}
 for(const m of monthly){const r=(retention[m.platform]||[]).filter(r=>r[0].startsWith(m.month));if(r.length===m.days&&r.every(r=>typeof r[1]==='number'))m.registrations=r.reduce((s,r)=>s+r[1],0);}
 const cohortData=await buildCohortData(live),cohorts=cohortData.cohorts,channels=await buildChannels(live),payments=await buildPayments(live),backendMetrics=await buildBackendMetrics(live);const evidence=await read(live+'/causal-evidence-20261020.json');
 const merchant={};for(const [kind,files]of Object.entries({out:['merchant-out-2026-09-01_2026-10-19-page1.json','merchant-out-2026-09-01_2026-10-19-page2.json'],in:['merchant-in-2026-09-01_2026-10-19-page1.json']})){merchant[kind]=[];for(const file of files){const obj=await read(live+'/'+file);merchant[kind].push(...obj.rows.slice(1));}}
 // Use the reviewed evidence summary for findings. Dedicated-subtab captures are
 // deliberately excluded: their old table can remain visible after a new query.
 let investigationEvidence=null;try{investigationEvidence=await read(live+'/player-investigation.json');}catch(e){if(e.code!=='ENOENT')throw e;}
 const reviewedPlayers=new Map((investigationEvidence?.players||[]).map(p=>[String(p.aid),p]));
 const investigation=[];for(const m of evidence.priorityMiddleMembers){
  const reviewed=reviewedPlayers.get(String(m.aid));
  const limits=[...(investigationEvidence?.limitations||[])];
  const item={...m,checked:false,verified:false,verificationStatus:'not_captured',coin:null,wash:null,coinAt:null,washAt:null,balancesSameTime:false,balanceIsCurrent:false,ledgerThrough:null,rows:[],sampledRows:0,totalRows:null,lowCoinResidualEvidence:false,pairedAt:null,pairedCoin:null,pairedWash:null,lowCoinResidualSamples:[],causalConfirmed:false,causalVerdict:'尚未證實清碼關閉造成停止儲值',subtabsVerified:false,subtabVerification:{deposit:false,gifts:false,wash:false},limits};
  try{
   const log=await read(live+'/player-ledger-'+m.aid+'-oct.json');
   const rows=(log.rows||[]).slice(1).filter(r=>Array.isArray(r)&&r.length===8&&/^2026-/.test(r[0]));
   const wr=rows.find(r=>r[3]==='洗碼量'),cr=rows.find(r=>r[3]==='金幣');
   // Only retain reviewed paired samples that can be traced to two ledger rows
   // with exactly the same timestamp. Independent latest balances are not pairs.
   const paired=(reviewed?.resourceLedger?.lowCoinResidualSamples||[]).filter(p=>
    Number.isFinite(p.coin)&&p.coin<=10&&Number.isFinite(p.wash)&&p.wash>0&&
    rows.some(r=>r[0]===p.at&&r[3]==='金幣'&&Number(r[6])===p.coin)&&
    rows.some(r=>r[0]===p.at&&r[3]==='洗碼量'&&Number(r[6])===p.wash)
   );
   // Captured/complete and identity-verified are separate. Missing end-AID
   // provenance must never be silently promoted to a verified player query.
   const endAid=log.queryAidAfter??log.aidAfter??log.queryValidation?.endAid??null;
   const verified=log.verified===true&&String(endAid)===String(m.aid);
   const complete=Number.isFinite(log.totalRows)&&log.totalRows===rows.length;
   Object.assign(item,{checked:rows.length>0,verified,verificationStatus:verified?'verified':rows.length?'captured_attribution_audit_pending':'not_captured',observedAt:log.queriedAt,ledgerThrough:rows[0]?.[0]||null,wash:wr?Number(wr[6]):null,washAt:wr?.[0]||null,coin:cr?Number(cr[6]):null,coinAt:cr?.[0]||null,balancesSameTime:!!(wr&&cr&&wr[0]===cr[0]),sampledRows:rows.length,totalRows:log.totalRows??null,complete,rows,lowCoinResidualEvidence:paired.length>0,pairedAt:paired[0]?.at||null,pairedCoin:paired[0]?.coin??null,pairedWash:paired[0]?.wash??null,lowCoinResidualSamples:paired,evidenceLevel:paired.length?'mechanism_signal_only':'insufficient',evidenceSource:'player-investigation.json',resourceSource:'player-ledger-'+m.aid+'-oct.json'});
   if(!verified)item.limits.push('此資源檔未保留可驗證的查詢結束AID快照；checked代表已擷取，verified仍為false。');
  }catch(e){if(e.code!=='ENOENT')throw e;}
  investigation.push(item);
 }
 const promoSep=await read(live+'/deposit-promos-2026-09-01_2026-09-19.json'),promoOct=await read(live+'/deposit-promos-2026-10-01_2026-10-19.json');
 const promoSummary=promoOct.tables[0][0].slice(1).map((name,i)=>({name,sep:promoSep.tables[0].slice(1).filter(r=>/^2026-/.test(r[0])).reduce((s,r)=>s+Number(r[i+1].replaceAll(',','')),0),oct:promoOct.tables[0].slice(1).filter(r=>/^2026-/.test(r[0])).reduce((s,r)=>s+Number(r[i+1].replaceAll(',','')),0)}));
 let observations=null;try{observations=await read(live+'/competitor-observations.json');}catch(e){if(e.code!=='ENOENT')throw e;}
 const competitorList=[['o8','發又發','https://admin.8o8.tw:9955/'],['aos','黑桃A','https://admin.aos888.com:9955/'],['fcc','財哥','https://admin.fcc99.com:9955/'],['cgb','超吉爆','https://admin.cgb777.com:9955/'],['goldfun','金來快','https://admin.goldfun88.com:9955/'],['o9','黑狗兄','https://admin.o9play.com:9955/']];
 const obsRows=Array.isArray(observations)?observations:observations?.competitors||observations?.sites||[];
 const rawCompetitors=competitorList.map(([key,name,url])=>({key,name,url,permissionScope:'關鍵營運指標可見；會員個資與活動設置不可見。',...obsRows.find(x=>x.key===key||x.url===url)}));
 const competitors=backendMetrics.competitors.length?backendMetrics.competitors:rawCompetitors;
 const monthSnapshots=backendMetrics.monthSnapshots;
 const coinConversion=await loadCoinConversionPolicy();
 const {funding,fundingDaily,merchantCoverage}=await buildMerchantFunding(live,daily,coinConversion);
 const activeComposition=monthSnapshots.map(m=>({platform:m.platform,month:m.month,total:m.mau,existing:null,newRegistered:null,through:m.through,definition:'MAU為後台去重登入；當月註冊的活躍交集尚未取得，不能用註冊量代替。'}));
 const data={schema:1,generatedAt:new Date().toISOString(),timezone:'Asia/Taipei',platforms:platforms.map(p=>({...p,dailyThrough:daily[p.key]?.at(-1)?.[0]||null,dailyFrom:daily[p.key]?.[0]?.[0]||null,sourceRun:backendHistory[p.key]?.capturedAt||latest[p.key]?.run||null,access:backendHistory[p.key]?.access||null})),monthly,daily,retention,cohorts,channels,payments,monthSnapshots,funding,activeComposition,investigation,evidence,competitors,promoSummary,merchantSummary:evidence.merchantComparison,activity:[{name:'禮包',sep:29691,oct:113521},{name:'固定福利',sep:275341.67,oct:277570.85},{name:'週期活動',sep:253993,oct:199944},{name:'儲值優惠',sep:637612,oct:406788}],activityPeriod:['2026-09-01','2026-09-19','2026-10-01','2026-10-19'],update:{schedule:'每日 08:00 · Asia/Taipei',mode:'待驗證',requirements:'本機電腦開機、已登入後台、原營運更新成功。各站依後台來源完整度更新；缺資料不補零。'},definitions:{reportDeposit:'後台每日儲值加總；不是淨營收、毛利或扣除福利後的淨利。',directDeposit:'每日儲值欄加總；玩家名單以儲值排行為準，兩種報表口徑與截止日均保留。',merchant:'幣商成功贈予玩家的金幣量，為買幣方向代理指標；尚未核對現金成交與補幣、沖正。',churn:'依名單標示的前月付費母體追蹤；完整已確認幣商來源可納入僅買幣者。本月未官儲仍買幣者持續列有補入；兩通路缺資料時保留未知，未再補入不等於已離站。'}};
 data.sourcePolicy={mode:'backend_only',definition:'網站所有數字、圖表及分析計算只使用後台實際產出；雲端表僅參考分析架構及呈現方式，不作數值來源或缺值替補。',missing:'未取得後台來源時保留缺值及實際截止日。'};
 data.coinConversion=coinConversion;
 data.todayProgress=todayProgress;
 applyTodayProgressSources(data,await buildTodayProgressSources(live,{today}),{today});
 data.definitions.todayProgress='今日進度為台灣當日未結日快照，只在後台有明確今日列時提供；與只含昨日以前完整日期的日報、月度加總及前月同期比較分開。';
 data.fundingDaily=fundingDaily;
 data.ownedCashSources=ownedCashEvidence(ownedCashSources);
 data.registrationPeriods=await buildOwnedRegistrationPeriods(live,{today});
 data.detailRefresh=await buildDetailRefreshStatus(live);
 data.promotionPackages=await buildPromotionPackageData(live,{asOf:today});
 let availabilityConfig=null;try{availabilityConfig=await read(path.join(root,'config/platform-availability.json'));}catch(error){if(error.code!=='ENOENT')throw error;}
 for(const platform of data.platforms){const availability=availabilityConfig?.schema===1?availabilityConfig.platforms?.[platform.key]:null;if(availability)platform.availability={state:availability.state,source:availability.source,confirmedOn:availability.confirmedOn,message:availability.message};}
 for(const platform of data.platforms){
  const sources=data.ownedCashSources.filter(s=>s.platform===platform.key&&s.complete);
  platform.dailySources=sources.map(s=>({file:s.file,from:s.from,through:s.through,capturedAt:s.capturedAt,sourceUrl:s.sourceUrl,calendarCoverageComplete:s.calendarCoverageComplete,missingDates:s.missingDates}));
  const captures=[backendHistory[platform.key]?.dailyCapturedAt,backendHistory[platform.key]?.capturedAt,...sources.map(s=>s.capturedAt)].filter(s=>s&&Number.isFinite(Date.parse(s)));
  platform.dailyCapturedAt=captures.sort((a,b)=>Date.parse(b)-Date.parse(a))[0]??null;
 }
 data.qualityAudit=await buildQualityAudit(live,{today,fallbackDaily:daily});
 data.merchantCandidates=await buildMerchantCandidates(live);
 data.competitorMerchantNetwork=await buildCompetitorMerchantNetwork(live);
 data.competitorWeakInvestigation=await buildCompetitorRoleEvidence(live);
 data.competitorMerchantNetwork=applyConfirmedCompetitorRoles(data.competitorMerchantNetwork,data.competitorWeakInvestigation);
 data.competitorFundingScenarios=await buildCompetitorFunding(live,{policy:coinConversion});
 data.marketFundingComparisons=buildMarketFundingComparisons({merchantCoverage,fundingDaily,competitorFundingScenarios:data.competitorFundingScenarios,policy:coinConversion,today});
 const marketDaily=await buildMarketDailyComparisons(live,{daily,platforms:data.platforms,ownedCashSources:data.ownedCashSources,competitors,period:data.marketFundingComparisons.period,today});
 for(const row of data.marketFundingComparisons.rows){const observations=marketDaily.rows.find(s=>s.platform===row.platform);row.dailyMetrics=observations?{current:observations.current,previous:observations.previous}:null;}
 data.competitorArchives=await buildCompetitorArchives(live,{policy:coinConversion,competitors,fundingScenarios:data.competitorFundingScenarios,asOf:today});
 data.competitorArchive=data.competitorArchives.platforms.find(archive=>archive.platform==='o8')??null;
 try{const access=await read(live+'/competitor-history-access-20261021.json');for(const group of data.competitorFundingScenarios.platforms){group.historyAccess=access.restrictions?.find(item=>item.platform===group.platform&&item.result==='blocked')??null;}}catch(error){if(error.code!=='ENOENT')throw error;}
 data.machines=await buildMachineData(live,{platforms:[...platforms.map(p=>p.key),...data.competitors.map(p=>p.key)],months:Array.from({length:10},(_,i)=>'2026-'+String(i+1).padStart(2,'0'))});
 data.merchantCoverage=merchantCoverage;
 data.payerComparisons=cohortData.samePeriodComparisons;
 data.cohortCoverage=cohortData.domainCoverage;
 data.memberComposition=await buildMemberComposition(live,{data,asOf:today});
 data.channelsByPlatform=await buildCurrentChannels(live,{data,asOf:today});
 data.definitions.conversion=CONVERSION_DEFINITION;
 data.definitions.revenue=REVENUE_DEFINITION;
 data.monthlyReports=buildMonthlyReports(data,{asOf:today,policy:coinConversion});
 data.historyProgress=await buildHistoryProgress(data,{asOf:today});
 await fs.mkdir(path.join(root,'data'),{recursive:true});await fs.writeFile(path.join(root,'data/dashboard.json'),JSON.stringify(data));
 console.log(JSON.stringify({platforms:data.platforms.map(p=>({key:p.key,dailyThrough:p.dailyThrough})),months:monthly.length,cohortPairs:cohorts.length,cohortRows:cohorts.reduce((s,c)=>s+c.rows.length,0),channels:channels.channels.length,investigated:investigation.filter(x=>x.checked).length}));return data;
}
if(process.argv[1]===fileURLToPath(import.meta.url))await collect();
