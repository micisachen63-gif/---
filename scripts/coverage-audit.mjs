import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {normalizeDaily,normalizeMonthly,parseBackendNumber} from './backend-metrics.mjs';

const ROOT=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const LIVE='C:/Users/User/Documents/ChatGPT/outputs/01a15831-ccf2-7fc3-bbe2-813c2cd1dc71/live-data';
const PLATFORMS=[['win','贏麻了','winmalo.com'],['qz','茄子','qzplays.com'],['song','爽爆','song-yy.com'],['rd','紅鑽','rdplays.com'],['lucky','來好運','lylucky.com'],['bo','來博','lybobet.com'],['o8','發又發','8o8.tw'],['aos','黑桃A','aos888.com'],['fcc','財哥','fcc99.com'],['cgb','超吉爆','cgb777.com']].map(([key,name,host],i)=>({key,name,url:'https://admin.'+host+':9955/',kind:i<6?'own':'competitor'}));
const datePattern=/^\d{4}-\d{2}-\d{2}$/;
const taipeiDate=value=>new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Taipei',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(value));
const prevDate=value=>new Date(Date.parse(value+'T00:00:00Z')-86400000).toISOString().slice(0,10);
const unique=values=>[...new Set(values)].sort();
export function dateRange(from,to){const result=[];for(let t=Date.parse(from+'T00:00:00Z');t<=Date.parse(to+'T00:00:00Z');t+=86400000)result.push(new Date(t).toISOString().slice(0,10));return result;}
function period(value){return Array.isArray(value)?{from:value[0],to:value[1]}:value?.from?{from:value.from,to:value.to}:null;}
function table(value){if(!value)return{header:[],rows:[]};return Array.isArray(value)?{header:value[0]??[],rows:value.slice(1)}:{header:value.header??value.rows?.[0]??[],rows:value.header?value.rows??[]:value.rows?.slice(1)??[]};}
function datesFromRows(rows,index=0){return unique((rows??[]).filter(Array.isArray).map(r=>String(r[index]??'').slice(0,10)).filter(d=>datePattern.test(d)));}
function unknown(reason,from,to,sources=[]){return{status:'unknown',from:null,to:null,availableDateCount:null,missingCompleteDates:null,unknownPeriod:{from,to},sources,reason};}
export function auditDateSeries(dates,{start,today,sources=[],definition=null}){
 const lastCompleteDay=prevDate(today),valid=unique(dates.filter(d=>datePattern.test(d)&&d>=start&&d<=today));
 if(!valid.length)return{...unknown('未找到可驗證的日期資料；不能視為零。',start,lastCompleteDay,sources),todayPartial:{date:today,available:false},definition};
 const expected=dateRange(start,lastCompleteDay),seen=new Set(valid),missing=expected.filter(d=>!seen.has(d));
 return{status:missing.length?'partial':'complete_through_last_complete_day',from:valid[0],to:valid.at(-1),availableDateCount:valid.length,completeDayCount:valid.filter(d=>d<=lastCompleteDay).length,expectedCompleteDayCount:expected.length,missingCompleteDates:missing,missingCompleteDateCount:missing.length,todayPartial:{date:today,available:seen.has(today),isCompleteDay:false},sources,definition};
}
function source(file,raw,extra={}){return{file,capturedAt:raw?.capturedAt??null,sourceUrl:raw?.sourceUrl??null,...extra};}
function periodAudit(windows,context){
 const confirmed=windows.filter(w=>w.complete===true&&datePattern.test(w.from??'')&&datePattern.test(w.to??''));
 const dates=confirmed.flatMap(w=>dateRange(w.from,w.to));
 const audited=auditDateSeries(dates,{...context,sources:windows.map(w=>w.source)});
 return{...audited,coverageKind:'query_period_not_transaction_activity_dates',windows,definition:context.definition??'只計完整來源查詢的覆蓋區間；沒有交易的日期不由本審計填零。'};
}
function rawDaily(raw){return Array.isArray(raw?.daily)?raw.daily:normalizeDaily(raw?.consumeDaily??raw);}
function monthlyAudit(raw,platform,context,file){
 const rows=normalizeMonthly(platform,raw?.consumeMonthly??raw?.tables?.consumeMonthly,raw?.activeMonthly??raw?.tables?.activeMonthly,raw??{}),expected=Array.from({length:Number(context.today.slice(5,7))},(_,i)=>context.start.slice(0,4)+'-'+String(i+1).padStart(2,'0'));
 if(!rows.length)return{...unknown('未取得MAU／MPU月報。',context.start,context.today),availableMonths:null,missingMonths:null};
 const snapshots=rows.map(m=>({month:m.month,through:m.through,partial:m.partial,capturedAt:m.capturedAt,sourceUrl:m.sourceUrl,fieldsAvailable:{mau:m.mau!==null,mpu:m.mpu!==null,deposit:m.deposit!==null,payRate:m.payRate!==null,arpu:m.arpu!==null,arppu:m.arppu!==null}}));
 return{status:'monthly_snapshots_available',from:rows[0].month,to:rows.at(-1).month,availableMonths:rows.map(m=>m.month),missingMonths:expected.filter(m=>!rows.some(r=>r.month===m)),completedMonths:rows.filter(m=>m.partial===false).map(m=>m.month),partialMonths:snapshots.filter(m=>m.partial),snapshots,sources:[source(file,raw)],definition:'月報去重MAU／MPU與完整日日報分開；月報當期包含採集時的當日進度，不能填補每日缺日。'};
}
function retentionAudit(raw,context,file){
 const rows=raw?.retention??[],valid=rows.filter(r=>datePattern.test(String(r[0]))),info=raw?.registrationSource;
 return{...auditDateSeries(datesFromRows(valid),{...context,sources:info?[source(file,info,{sourceUrl:info.sourceUrl})]:[],definition:info?.definition??'X日登0日登cohort；需另對實際創帳總數核對。'}),unknownCountDates:valid.filter(r=>parseBackendNumber(r[1])===null).map(r=>r[0]),dailyCountsPresent:valid.length>0,actualRegistrationDateIntersectionVerified:false};
}
function missingMonthlyToday(monthly,today){return monthly.partialMonths?.find(m=>m.month===today.slice(0,7)&&m.through===today)??null;}
function activityAudit(documents,context){
 const kinds={moneyflow:'總金流／禮包與總量',fixed:'固定福利',periodic:'週期活動','deposit-promos':'儲值優惠發幣'};
 const submodules=Object.entries(kinds).map(([kind,name])=>{
  const relevant=[...documents].filter(([f])=>f.startsWith(kind+'-'));
  const dates=relevant.flatMap(([,d])=>Object.values(d.tables??{}).flatMap(t=>datesFromRows(table(t).rows)));
  return{kind,name,...auditDateSeries(dates,{...context,sources:relevant.map(([f,d])=>source(f,d)),definition:'發放金幣量；不是現金成本、活動因果或成交訂單數。'})};
 });
 const sets=submodules.map(m=>new Set(m.sources.flatMap(s=>{const d=documents.get(s.file);return Object.values(d?.tables??{}).flatMap(t=>datesFromRows(table(t).rows));})));
 const common=sets.length?[...sets[0]].filter(d=>sets.every(s=>s.has(d))):[];
 return{...auditDateSeries(common,{...context,sources:submodules.flatMap(m=>m.sources),definition:'只有各發放子模組同時覆蓋才視為整體活動金幣覆蓋。'}),submodules,effectiveness:{status:'unknown',reason:'未取得參與會員、有效對照與現金成本，不能確認增量或ROI。'}};
}

export async function buildCoverageAudit(live=LIVE,{today='2026-10-20'}={}){
 if(!datePattern.test(today))throw Error('today must be YYYY-MM-DD');
 const start=today.slice(0,4)+'-01-01',lastCompleteDay=prevDate(today),context={start,today};
 const names=(await fs.readdir(live)).filter(f=>f.endsWith('.json')).sort(),documents=new Map();
 for(const file of names){try{documents.set(file,JSON.parse((await fs.readFile(path.join(live,file),'utf8')).replace(/^\uFEFF/,'')));}catch(e){throw Error('無法審計來源 '+file+': '+e.message);}}
 const compRoot=documents.get('competitor-observations.json'),competitors=compRoot?.competitors??[],audited=[];
 for(const p of PLATFORMS){
  const file=p.kind==='own'?'backend-history-'+p.key+'.json':'competitor-observations.json',raw=p.kind==='own'?documents.get(file):competitors.find(c=>c.key===p.key);
  const dailyRows=p.kind==='own'?rawDaily(raw):normalizeDaily(raw?.consumeDaily),dailySource=p.kind==='own'?raw:raw?.consumeDaily;
  const launchDate=p.key==='win'?'2026-01-16':null,scope={...context,start:launchDate??start};
  const daily=auditDateSeries(datesFromRows(dailyRows),{...context,start:launchDate??start,sources:raw?[source(file,dailySource)]:[],definition:'每日官儲、DAU、DPU、筆數及首付；開服前不列缺漏，開服後未回傳日期是未知，不能自動填零。'});
  daily.preLaunch=launchDate?{status:'not_launched',from:start,to:prevDate(launchDate),excludedDateCount:dateRange(start,prevDate(launchDate)).length,evidence:'使用者明確提供開服日。'}:null;
  daily.missingMetricDates=dailyRows.filter(r=>r.slice(1).some(v=>parseBackendNumber(v)===null)).map(r=>r[0]);
  const monthly=monthlyAudit(raw,p.key,context,file),currentMonth=missingMonthlyToday(monthly,today);
  daily.todayPartial.otherSnapshot=currentMonth?{kind:'month_to_date_only',capturedAt:currentMonth.capturedAt,through:currentMonth.through}:null;
  daily.todayPartial.homeSnapshotAvailable=!!(p.kind==='competitor'&&raw?.homeSnapshot?.capturedAt&&taipeiDate(raw.homeSnapshot.capturedAt)===today);
  const registration=p.kind==='own'?retentionAudit(raw,scope,file):{...periodAudit(Object.values(raw?.newRegistrations??{}).map(n=>({...n.period,complete:typeof n.newRegistered==='number',source:source(file,n)})),{...context,definition:'玩家總覽按創帳日期查詢的期間新增總數；不是逐日分解。'}),dailyCountsPresent:false};
  const restricted=p.kind==='competitor';
  const channels=unknown(restricted?'未取得可見權限內的來源渠道彙總；不抓會員個資。':'未取得完整年度註冊渠道名單。',scope.start,lastCompleteDay);
  const merchant=unknown(restricted?'未取得權限內的幣商方向彙總；不能以全部收贈禮代替幣商。':'未取得指定幣商完整收贈禮。',scope.start,lastCompleteDay);
  const activities=unknown('未取得全年金流與各發放子模組。',scope.start,lastCompleteDay);
  const packages={...unknown('未取得成功儲值包訂單數、實付額與商品類型；發幣量不能當購買量。',scope.start,lastCompleteDay),purchaseOrdersAvailable:false};
  const payerRank=unknown(restricted?'會員個資不在競品觀測範圍；只有聚合MPU月報，沒有可驗證逐人名單。':'未取得完整逐月儲值排行。',scope.start,lastCompleteDay);
  const game=restricted?periodAudit(Object.values(raw?.gameSummaries??{}).map(g=>({...g.period,complete:Array.isArray(g.summary)&&g.rows?.length>0,source:source(file,g,{units:g.units??null})})),{...context,definition:'機台彙總投注／派彩／RTP，保持原遊戲單位；不是逐日資料。'}):unknown('未取得全年遊戲投注、派彩、RTP來源。',scope.start,lastCompleteDay);
  audited.push({...p,launchDate,capturedAt:raw?.capturedAt??null,modules:{daily,monthly,registration,channels,merchant,activities,packages,payerRank,game,activeComposition:{...unknown('MAU中的當月註冊／既有交集尚未取得；不能使用NU替代。',scope.start,lastCompleteDay),totalMAUAvailable:!!monthly.availableMonths?.length}},accessScope:restricted?{excluded:['會員個資','活動設置'],allowed:'僅使用帳號可見聚合KPI'}:{allowed:'已授權自有站後台只讀資料'}});
 }
 const win=audited.find(p=>p.key==='win'),winRaw=documents.get('backend-history-win.json'),winContext={...context,start:win.launchDate??start};
 const members=[...documents].filter(([name])=>/^members-2026-/.test(name));
 const memberWindows=members.map(([file,raw])=>{
  const data=table(raw),idx=data.header.indexOf('創帳時間'),aidIndex=data.header.indexOf('a_id'),periodValue=period(raw.period),counts=new Map();
  for(const r of data.rows){const date=String(r[idx]??'').slice(0,10);if(datePattern.test(date))counts.set(date,(counts.get(date)??0)+1);}
  const retention=(winRaw?.retention??[]).filter(r=>periodValue&&r[0]>=periodValue.from&&r[0]<=periodValue.to);
  const matching=retention.length>0&&retention.every(r=>parseBackendNumber(r[1])!==null&&(counts.get(r[0])??0)===parseBackendNumber(r[1]));
  const ids=data.rows.map(r=>r[aidIndex]),noDuplicateIds=new Set(ids).size===ids.length;
  const verifiedThrough=matching?retention.at(-1)[0]:null;
  return{from:periodValue?.from??null,to:verifiedThrough,queryTo:periodValue?.to??null,complete:matching&&noDuplicateIds,rowCount:data.rows.length,source:source(file,raw),validation:{registrationDailyDatesCompared:retention.length,countsMatch:matching,noDuplicateIds},todayPartial:periodValue?.to===today?{date:today,capturedAt:raw.capturedAt,rowCountAtCapture:counts.get(today)??null}:null};
 });
 win.modules.channels={...periodAudit(memberWindows,winContext),status:memberWindows.some(w=>w.complete)?'partial':'unverified_snapshot',definition:'註冊名單含來源；僅與後台0日登逐日數目吻合且無重複AID的日期，列為核對完成。不是歷史會員狀態快照。'};
 const incompleteMembers=[...documents].filter(([f,d])=>/^members-win-/.test(f)&&d.complete===false).map(([file,d])=>({file,rowCount:d.rows?.length??null,totalRows:d.totalRows??null,page:d.page??null,pageSize:d.pageSize??null,totalPages:d.totalRows&&d.pageSize?Math.ceil(d.totalRows/d.pageSize):null,remainingPages:d.totalRows&&d.pageSize&&d.page?Math.max(0,Math.ceil(d.totalRows/d.pageSize)-d.page):null,complete:false}));
 win.modules.channels.incompleteSnapshots=incompleteMembers;
 const merchantGroups={buy:['merchant-out-2026-09-01_2026-10-19-page1.json','merchant-out-2026-09-01_2026-10-19-page2.json'],sell:['merchant-in-2026-09-01_2026-10-19-page1.json']},directions=[];
 for(const [direction,files] of Object.entries(merchantGroups)){
  const snapshots=files.map(file=>documents.get(file)),rows=snapshots.flatMap(d=>table(d).rows),expectedRows=Number(snapshots[0]?.summary?.join(' ').match(/Total Rows:\s*(\d+)/)?.[1]??NaN),expectedAmount=Number(snapshots[0]?.summary?.join(' ').match(/贈禮總金額\s*:\s*([\d.]+)/)?.[1]??NaN),amounts=rows.map(r=>parseBackendNumber(r[4])),sum=amounts.every(v=>v!==null)?amounts.reduce((a,b)=>a+b,0):null,complete=snapshots.every(Boolean)&&rows.length===expectedRows&&sum!==null&&Math.abs(sum-expectedAmount)<0.01;
  directions.push({direction,from:'2026-09-01',to:'2026-10-19',complete,pageCount:files.length,rowCount:rows.length,expectedRows:Number.isFinite(expectedRows)?expectedRows:null,amountCheckMatched:complete,sources:files.map((file,i)=>source(file,snapshots[i]))});
 }
 win.modules.merchant={...periodAudit(directions.map(d=>({...d,source:{files:d.sources.map(s=>s.file),capturedAt:d.sources.at(-1)?.capturedAt}})),winContext),directions,merchantIdentityScope:'僅兩個已指定幣商；其他站幣商身份尚待明確對應。',definition:'成功方向收贈禮的完整分頁，筆數及總金額均核對；不由交易日期缺列推算零。'};
 win.modules.activities=activityAudit(documents,winContext);
 win.modules.packages.grantData=win.modules.activities.submodules.find(s=>s.kind==='deposit-promos');
 const ranks=[...documents].filter(([f])=>/^deposit-ranking-win-\d{4}-\d{2}\.json$/.test(f)).map(([file,d])=>{const p=period(d.period);return{from:p?.from,to:p?.to,complete:d.complete===true&&d.validation?.matching===true,rowCount:table(d).rows.length,source:source(file,d),validation:d.validation??null};});
 win.modules.payerRank={...periodAudit(ranks,winContext),monthlySnapshots:ranks,supplementalCurrentSnapshot:documents.has('deposit-ranking-2026-10-current.json')?{source:source('deposit-ranking-2026-10-current.json',documents.get('deposit-ranking-2026-10-current.json')),queryPeriod:documents.get('deposit-ranking-2026-10-current.json').period,rows:table(documents.get('deposit-ranking-2026-10-current.json')).rows.length,complete:false,note:'本次讀取時快照未有明確截止日與完整性驗證，不替代10/20逐日或完整月。'}:null};
 const queryPlan=[
  {priority:0,module:'daily',platforms:PLATFORMS.map(p=>p.key),report:'玩家總表／玩家消費',route:'/statements/player-summary',period:{from:start,to:today},platformStartOverrides:{win:'2026-01-16'},minimumQueries:10,estimatedPagesPerQuery:1,expectedDateRows:dateRange(start,today).length,notes:['10/20標為未完整日，10/19以前核對日期連續。','贏麻了1/16開服，1/1–15不列缺漏；僅1/17–18兩個開服後缺日待查，不補零。']},
  {priority:0,module:'monthly',platforms:PLATFORMS.map(p=>p.key),report:'玩家活躍（月）＋玩家消費（月）',route:'/statements/player-summary',period:{from:start.slice(0,7),to:today.slice(0,7)},minimumQueries:20,estimatedPagesPerQuery:1,notes:['保留月報capturedAt與台灣當日時間，不把當期月報當日明細。']},
  {priority:1,module:'registration',platforms:PLATFORMS.map(p=>p.key),report:'X日登0日登＋玩家總覽創帳數核對',route:'/statements/xlogin',period:{from:start,to:today},minimumQueries:10,estimatedPagesPerQuery:1,notes:['自有六站需補1–8月和當日；競品只能取得聚合註冊，與創帳總數核對。']},
  {priority:1,module:'merchant',platforms:PLATFORMS.slice(0,6).map(p=>p.key),report:'收贈禮統計／指定幣商兩方向／成功',route:'/statements/giving',period:{from:start,to:today},minimumQueries:12,pageSize:1000,estimatedPagesPerQuery:null,notes:['先辨識各站幣商AID，不能把所有玩家互送視為買賣幣。','全年總筆數首次查詢後才能估頁；現有win49日買方向2頁、賣方向1頁。']},
  {priority:1,module:'payerRank',platforms:PLATFORMS.slice(0,6).map(p=>p.key),report:'逐月儲值排行',route:'/statements/deposit-ranking',months:Array.from({length:Number(today.slice(5,7))},(_,i)=>today.slice(0,4)+'-'+String(i+1).padStart(2,'0')),missingOwnPlatformMonthQueries:50,refreshWinCurrentMonthQueries:1,estimatedPagesPerQuery:null,notes:['Win十個月完整排行已有，其他五站各十個月未取得。','Win已觀測可一次回完整排行；其他站需實際檢查限制，期間儲值加總對月報／日報。','競品會員個資不在範圍，不要求逐人AID名單。']},
  {priority:2,module:'channels',platforms:PLATFORMS.slice(0,6).map(p=>p.key),report:'玩家列表／創帳時間／來源',route:'/player/list',period:{from:start,to:today},pageSize:1000,knownWinTotalRows:incompleteMembers[0]?.totalRows??null,knownWinTotalPages:incompleteMembers[0]?.totalPages??null,knownWinRemainingPages:incompleteMembers[0]?.remainingPages??null,otherPlatformsEstimatedPages:null,notes:['Win已知23770筆是10/19當次查詢，更新到今日要重新核對總筆數。','競品僅用可見的來源渠道聚合，不讀會員個資。']},
  {priority:2,module:'activities',platforms:PLATFORMS.map(p=>p.key),report:'總金流／禮包、固定、週期、儲值優惠',route:'/statements/moneyflow',period:{from:start,to:today},minimumQueries:40,estimatedPagesPerQuery:1,notes:['只讀帳號可見聚合，不能以遊戲活動加贈欄或發幣量代替全部活動效益。']},
  {priority:2,module:'packages',platforms:PLATFORMS.slice(0,6).map(p=>p.key),report:'儲值報表／成功訂單商品類型及筆數',route:'/statements/deposit-statements',period:{from:start,to:today},minimumQueries:6,estimatedPagesPerQuery:null,notes:['先確認成功訂單與商品類型是否可見，再估頁。一次／限時包發幣表不是成功購買數。']}
 ];
 return{schema:1,generatedAt:new Date().toISOString(),auditType:'read_only_raw_source_coverage',liveDirectory:live,requestedWindow:{from:start,to:today,lastCompleteDay,todayIsPartial:true,expectedCompleteDays:dateRange(start,lastCompleteDay).length,expectedDatesIncludingToday:dateRange(start,today).length},platforms:audited,queryPlan,sourceInventory:{jsonFilesScanned:names.length,individualPlayerProbeFiles:names.filter(f=>/^player-(ledger|deposit|gifts|wash)-/.test(f)).length,individualProbesCountAsPlatformCoverage:false},definitions:['unknown及缺日代表未取得或尚未驗證，與零交易不同。','完整查詢期間覆蓋與實際有交易日期分開；完整分頁可覆蓋無交易日期，但本審計不產生數值零。','本檔只存日期、來源與聚合完整性；不輸出會員AID、暱稱、電話、帳密。','全年的意思是2026/01/01至指定今日；今日未完整日與截至昨日完整資料分開。']};
}

if(process.argv[1]===fileURLToPath(import.meta.url)){
 const today=process.argv.find(a=>/^--today=/.test(a))?.slice(8)??'2026-10-20';
 const audit=await buildCoverageAudit(LIVE,{today});
 await fs.writeFile(path.join(ROOT,'data/coverage-audit.json'),JSON.stringify(audit,null,2));
 console.log(JSON.stringify({platforms:audit.platforms.length,completeThrough:audit.requestedWindow.lastCompleteDay,today,coverage:audit.platforms.map(p=>({key:p.key,dailyDates:p.modules.daily.availableDateCount,dailyThrough:p.modules.daily.to,missingCompleteDates:p.modules.daily.missingCompleteDateCount,months:p.modules.monthly.availableMonths?.length??null,registrationDates:p.modules.registration.availableDateCount,merchant:p.modules.merchant.status,payerRank:p.modules.payerRank.status}))}));
}
