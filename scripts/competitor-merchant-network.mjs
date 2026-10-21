import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';

const SITES={o8:{name:'發又發',host:'admin.8o8.tw:9955'},aos:{name:'黑桃A',host:'admin.aos888.com:9955'},fcc:{name:'財哥',host:'admin.fcc99.com:9955'},cgb:{name:'超吉爆',host:'admin.cgb777.com:9955'},goldfun:{name:'金來快',host:'admin.goldfun88.com:9955'},o9:{name:'黑狗兄',host:'admin.o9play.com:9955'}};
const validDate=d=>typeof d==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(d)&&Number.isFinite(Date.parse(d))&&new Date(d).toISOString().slice(0,10)===d;
const taipeiDay=t=>typeof t==='string'&&Number.isFinite(Date.parse(t))?new Date(Date.parse(t)+8*3600000).toISOString().slice(0,10):null;
const number=v=>{if(typeof v==='number')return Number.isFinite(v)?v:null;const text=String(v??'').trim();return /^-?(?:\d+|\d{1,3}(?:,\d{3})+)(?:\.\d+)?$/.test(text)?Number(text.replaceAll(',','')):null;};
const ratio=(a,b)=>typeof a==='number'&&typeof b==='number'&&b>0?a/b:null;
function dates(from,through){const result=[];if(!validDate(from)||!validDate(through)||from>through)return result;for(let t=Date.parse(from);t<=Date.parse(through);t+=86400000)result.push(new Date(t).toISOString().slice(0,10));return result;}
function proof(d){const p=d.queryProof??d.dateProof??d.selectedDateProof??{};return{from:p.selectedFrom??p.from??d.selectedFrom??null,through:p.selectedThrough??p.through??p.to??d.selectedThrough??null,verified:(p.verified??p.dateVerified??d.queryDateVerified)===true,freshResultVerified:p.freshResultVerified===true};}
const edgeKey=(from,to)=>JSON.stringify([from,to]);

export function parseCompetitorNetworkSource(file,data){
 const d=data&&typeof data==='object'&&!Array.isArray(data)?data:{},week=/^gift-network-week-(o8|aos|fcc|cgb|goldfun|o9)-(\d{4}-\d{2}-\d{2})_(\d{4}-\d{2}-\d{2})\.json$/.exec(file),day=/^gift-daily-rank-(o8|aos|fcc|cgb|goldfun|o9)-(\d{4}-\d{2}-\d{2})\.json$/.exec(file),platform=(week??day)?.[1]??d.platform,from=week?.[2]??day?.[2]??d.from,through=week?.[3]??day?.[2]??d.through,query=proof(d),issues=[];
 const add=code=>{if(!issues.includes(code))issues.push(code);};
 if(!week&&!day)add('unsupported_filename');if(!SITES[platform]||d.platform!==platform)add('platform_mismatch');
 if(!validDate(from)||!validDate(through)||from>through||d.from!==from||d.through!==through)add('period_mismatch');
 const captureDate=taipeiDay(d.capturedAt);if(!captureDate)add('capture_time_missing');else if(through>captureDate)add('through_after_capture');
 if(query.from!==from||query.through!==through||!query.verified)add('selected_dates_not_verified');
 let sourceUrl=null;try{const u=new URL(d.sourceUrl);if(u.protocol!=='https:'||u.host!==SITES[platform]?.host||u.pathname.replace(/\/$/,'')!=='/statements/giving'||u.username||u.password)add('untrusted_source_url');else sourceUrl=u.origin+u.pathname;}catch{add('untrusted_source_url');}
 if(d.tab!=='贈禮排行')add('wrong_report_tab');if(d.complete!==true)add('source_incomplete');
 const header=d.header??[],rows=Array.isArray(d.rows)?d.rows:[],required=['贈禮AID','贈禮暱稱','對象AID','對象暱稱','贈禮總金額','差額'],indexes=Array.isArray(header)?required.map(k=>header.indexOf(k)):[];
 if(indexes.length!==required.length||indexes.some(i=>i<0))add('required_columns_missing');
 const expectedRows=number(d.totalRows);if(!Number.isSafeInteger(expectedRows)||expectedRows<0||expectedRows!==rows.length)add('row_count_mismatch');
 const edges=new Map(),names=new Map();let duplicatePairs=0,invalidRows=0,netChecked=0,netMatched=0;
 if(indexes.length===required.length&&indexes.every(i=>i>=0))for(const row of rows){
  if(!Array.isArray(row)){invalidRows++;continue;}const [rawFrom,fromName,rawTo,toName,rawAmount,rawDelta]=indexes.map(i=>row[i]),a=rawFrom==null?'':String(rawFrom).trim(),b=rawTo==null?'':String(rawTo).trim(),amount=number(rawAmount),delta=number(rawDelta);
  if(!a||!b||amount===null||amount<0||delta===null){invalidRows++;continue;}if(fromName!=null)names.set(a,String(fromName));if(toName!=null)names.set(b,String(toName));
  const key=edgeKey(a,b),old=edges.get(key);if(old){duplicatePairs++;if(old.coins!==amount||old.delta!==delta)add('conflicting_duplicate_pair');continue;}edges.set(key,{fromAid:a,toAid:b,coins:amount,delta});
 }
 if(invalidRows)add('invalid_directed_rows');
 for(const edge of edges.values()){const reverse=edges.get(edgeKey(edge.toAid,edge.fromAid));netChecked++;if(Math.abs(edge.coins-(reverse?.coins??0)-edge.delta)<.01)netMatched++;}
 if(netChecked!==netMatched)add('directed_net_mismatch');
 const partial=d.partial===true||d.currentDayPartial===true||through===captureDate;
 return{file,kind:week?'weekly':'daily',platform,from,through,date:day?from:null,sourceUrl,capturedAt:captureDate?d.capturedAt:null,captureDate,sourceComplete:typeof d.complete==='boolean'?d.complete:null,dateProofVerified:query.verified&&query.from===from&&query.through===through,freshResultVerified:query.freshResultVerified,complete:issues.length===0,partial,rowCount:rows.length,totalRows:expectedRows,issues,validation:{duplicatePairs,invalidRows,netChecked,netMatched},edges,names,signature:createHash('sha256').update(JSON.stringify([...edges].sort(([a],[b])=>a.localeCompare(b)))).digest('hex')};
}

function graph(source){
 const accounts=new Map(),get=aid=>{if(!accounts.has(aid))accounts.set(aid,{aid,nickname:source.names.get(aid)||'',out:0,in:0,peers:new Map()});return accounts.get(aid);},peer=(a,id)=>{if(!a.peers.has(id))a.peers.set(id,{out:0,in:0});return a.peers.get(id);};
 for(const edge of source.edges.values()){if(edge.fromAid===edge.toAid||edge.coins<=0)continue;const from=get(edge.fromAid),to=get(edge.toAid);from.out+=edge.coins;to.in+=edge.coins;peer(from,to.aid).out+=edge.coins;peer(to,from.aid).in+=edge.coins;}
 for(const a of accounts.values()){const peers=[...a.peers.values()],turnover=a.out+a.in,shares=peers.map(p=>(p.out+p.in)/turnover);a.weekly={out:a.out,in:a.in,netIn:a.in-a.out,turnover,uniqueCounterparties:a.peers.size,outCounterparties:peers.filter(p=>p.out>0).length,inCounterparties:peers.filter(p=>p.in>0).length,bidirectionalCounterparties:peers.filter(p=>p.out>0&&p.in>0).length,largestCounterpartyShare:shares.length?Math.max(...shares):null,hhi:shares.length?shares.reduce((s,p)=>s+p*p,0):null};}
 return accounts;
}
function sourceMetadata(s){return{file:s.physicalFile??s.file,sourceFile:s.physicalFile??s.file,date:s.date,from:s.from,through:s.through,sourceUrl:s.sourceUrl,capturedAt:s.capturedAt,sourceComplete:s.sourceComplete,dateProofVerified:s.dateProofVerified,complete:s.complete,partial:s.partial,rowCount:s.rowCount,totalRows:s.totalRows,issues:s.issues,validation:s.validation,...(s.derived?{derived:true,dataBasis:s.dataBasis,sourceReferences:s.sourceReferences}: {})};}
function relation(account,hub){const own=new Set(account.peers.keys()),other=new Set(hub.peers.keys()),shared=[...own].filter(id=>other.has(id)&&id!==account.aid&&id!==hub.aid).length,union=new Set([...own,...other]).size;return{hubAid:hub.aid,hubNickname:hub.nickname,count:shared,jaccard:ratio(shared,union),overlapOfCandidate:ratio(shared,own.size)};}
function dailyFeature(account,completed,todaySource,graphs){
 const series=completed.map(s=>{const a=graphs.get(s.file).get(account.aid);return{date:s.date,out:a?.out??0,in:a?.in??0,active:!!a&&(a.out>0||a.in>0),complete:true};}),active=series.filter(d=>d.active),today=todaySource?graphs.get(todaySource.file).get(account.aid):null;
 return{activeCompleteDays:completed.length?active.length:null,observedCompleteDays:completed.length,completeDayDates:series.map(d=>d.date),activeDates:active.map(d=>d.date),series,todayPartialActivity:todaySource?{date:todaySource.date,out:today?.out??0,in:today?.in??0,active:!!today&&(today.out>0||today.in>0),partial:true,capturedAt:todaySource.capturedAt}:null};
}

export function analyzeCompetitorMerchantNetworks(reports,{asOf=taipeiDay(new Date().toISOString())}={}){
 return analyzeParsedNetworks(reports.map(r=>parseCompetitorNetworkSource(r.file,r.data)),{asOf});
}
function analyzeParsedNetworks(parsed,{asOf=taipeiDay(new Date().toISOString())}={}){
 if(!validDate(asOf))throw TypeError('asOf must be an ISO calendar date');
 const platforms=[];
 for(const [platform,site] of Object.entries(SITES)){
  const sources=parsed.filter(s=>s.platform===platform),weekly=sources.filter(s=>s.kind==='weekly').sort((a,b)=>String(b.through).localeCompare(String(a.through))||String(b.capturedAt).localeCompare(String(a.capturedAt)))[0]??null,from=weekly?.from??null,through=weekly?.through??null,expectedCompleteDays=dates(from,through).filter(d=>d<asOf),dailySources=[];
  for(const date of dates(from,through)){const found=sources.filter(s=>s.kind==='daily'&&s.date===date).sort((a,b)=>String(b.capturedAt).localeCompare(String(a.capturedAt)))[0];if(found)dailySources.push(found);}
  const completed=dailySources.filter(s=>s.complete&&!s.partial&&s.date<asOf&&s.date<s.captureDate),todaySource=dailySources.find(s=>s.date===asOf&&s.complete)??null,missingCompleteDays=expectedCompleteDays.filter(d=>!completed.some(s=>s.date===d)),duplicateDailyPayloads=[];
  for(const s of completed){const duplicates=completed.filter(other=>other.date!==s.date&&other.signature===s.signature&&s.rowCount>0);if(duplicates.length&&!s.freshResultVerified)duplicateDailyPayloads.push({date:s.date,otherDates:duplicates.map(x=>x.date)});}
  const coverage={weekly:weekly?{available:true,...sourceMetadata(weekly)}:{available:false,complete:false,sourceComplete:null,dateProofVerified:false,sourceFile:null,capturedAt:null,sourceUrl:null,rowCount:null,totalRows:null,issues:['weekly_source_missing']},expectedCompleteDays,dailyCompleteDays:completed.map(s=>s.date),missingCompleteDays,dailySources:dailySources.map(s=>({...sourceMetadata(s),eligibleCompleteDay:completed.includes(s)})),invalidDailySources:dailySources.filter(s=>!s.complete).map(sourceMetadata),duplicateDailyPayloads,todayPartial:todaySource?{...sourceMetadata(todaySource),date:asOf,available:true,partial:true}:{date:asOf,available:false,partial:true,file:null,capturedAt:null,sourceUrl:null},dailyWeeklyReconciliation:{status:!weekly?.complete?'weekly_unverified':!completed.length?'missing_daily':weekly.partial||through>=asOf?'partial_noncomparable':missingCompleteDays.length?'missing_daily':'pending',note:'逐日完整日與當日未結分開；不同採集時間的未結日不能與週快照強制對平。'}};
  const latestCapture=sources.filter(s=>s.complete&&s.capturedAt).map(s=>s.capturedAt).sort((a,b)=>Date.parse(b)-Date.parse(a))[0]??null;
  const result={platform,name:site.name,period:{from,through,todayDate:asOf},capturedAt:latestCapture,sourceUrl:weekly?.sourceUrl??null,derived:weekly?.derived===true,dataBasis:weekly?.dataBasis??'backend_weekly_ranking_snapshot',coverage,candidates:[],weakEvidence:[],coreHubs:[],edges:[],observedSubgroups:[],excludedProfiles:{narrowHighVolumeAccounts:0,ordinaryAccountsNotOutput:0},units:'本站後台原始金幣；不可跨站合計或視為現金',verified:false,includeInRevenue:false};
  if(!weekly?.complete){platforms.push(result);continue;}
  const network=graph(weekly),dailyGraphs=new Map([...completed,...(todaySource?[todaySource]:[])].map(s=>[s.file,graph(s)])),all=[...network.values()],core=all.filter(a=>a.weekly.uniqueCounterparties>=20&&a.weekly.bidirectionalCounterparties>=5&&a.weekly.largestCounterpartyShare<=.5),coreIds=new Set(core.map(a=>a.aid));
  const volumes=all.map(a=>a.weekly.turnover).sort((a,b)=>b-a),threshold=volumes[Math.max(0,Math.ceil(volumes.length*.1)-1)]??Infinity;
  const concentratedDistributors=new Set(all.filter(a=>a.weekly.outCounterparties>=10&&a.weekly.inCounterparties<=2&&a.in>0&&a.out>0&&a.weekly.largestCounterpartyShare>.5).map(a=>a.aid));
  result.coreHubs=core.map(a=>({aid:a.aid,nickname:a.nickname}));
  const selected=[];
  for(const account of all){
   const w=account.weekly,daily=dailyFeature(account,completed,todaySource,dailyGraphs),others=core.filter(h=>h.aid!==account.aid),shared=others.map(h=>relation(account,h)).sort((a,b)=>b.count-a.count),transferCoins=[...account.peers].filter(([id])=>coreIds.has(id)&&id!==account.aid).reduce((s,[,p])=>s+p.in+p.out,0),transferShare=ratio(transferCoins,w.turnover),largestShared=shared[0],broad=w.uniqueCounterparties>=8&&w.bidirectionalCounterparties>=2,oneWay=w.outCounterparties>=10&&w.inCounterparties<=w.outCounterparties*.5&&w.bidirectionalCounterparties<=w.outCounterparties*.2&&w.largestCounterpartyShare<=.5,linked=!!largestShared&&largestShared.count>=3&&(largestShared.overlapOfCandidate>=.25||transferShare>=.2);
   const coreInPeers=[...account.peers].filter(([id,p])=>coreIds.has(id)&&p.in>0).length,nonCoreOut=[...account.peers].filter(([id,p])=>!coreIds.has(id)&&p.out>0).length,consolidating=coreInPeers>=3&&w.outCounterparties===1&&nonCoreOut===1&&w.bidirectionalCounterparties===0&&ratio(w.out,w.in)>=.5&&ratio(w.out,w.in)<=2,relayLinked=[...account.peers].some(([id,p])=>concentratedDistributors.has(id)&&p.in>0&&p.out>0)&&w.largestCounterpartyShare>=.5,insufficientNameVolume=/金庫|全庫|財庫|金控/.test(account.nickname)&&w.uniqueCounterparties===1&&w.turnover>=threshold;
   let classification=null,confidence='weak',observationKind=null;
   if(coreIds.has(account.aid)){classification='primary_intermediary';confidence=completed.length>=3&&!missingCompleteDays.length&&!duplicateDailyPayloads.length&&daily.activeCompleteDays>=3?'strong':'moderate';}
   else if(broad&&linked){classification='possible_subhub';confidence='moderate';}
   else if(oneWay){classification='one_way_supplier';confidence='moderate';}
   else if(broad&&w.largestCounterpartyShare<=.65){classification='possible_subhub';confidence='moderate';}
   else if(concentratedDistributors.has(account.aid)){classification='watch';observationKind='concentrated_distribution';}
   else if(relayLinked){classification='watch';observationKind='relay_link';}
   else if(consolidating){classification='watch';observationKind='consolidating_settlement';}
   else if(insufficientNameVolume){classification='watch';observationKind='name_volume_insufficient';}
   else if(w.uniqueCounterparties>=5&&w.bidirectionalCounterparties>=2&&(linked||w.largestCounterpartyShare>=.5)){classification='watch';}
   if(!classification)continue;
   const evidence=[`週內與 ${w.uniqueCounterparties} 個對手往來，其中 ${w.bidirectionalCounterparties} 個雙向往來`,`最大單一對手佔收贈往來 ${(w.largestCounterpartyShare*100).toFixed(1)}%`,completed.length?`在已取得的 ${completed.length} 個完整日中活躍 ${daily.activeCompleteDays} 日`:'尚無逐日完整來源，無法確認持續活躍'],counterEvidence=['交易結構只是中介線索，無法確認幣商身分、抽成、實際現金或同一實控人'];
   if(missingCompleteDays.length)counterEvidence.push(`仍缺 ${missingCompleteDays.length} 個完整日觀測，未取得日期不當成無交易`);
   if(duplicateDailyPayloads.length)counterEvidence.push('不同日期出現完全相同的非空明細，持續性判斷需再核對結果新鮮度');
   if(completed.length&&daily.activeCompleteDays<=2)counterEvidence.push(`已取得 ${completed.length} 個完整日僅 ${daily.activeCompleteDays} 日活躍，持續服務證據有限；當日未結不補足完整活躍日`);
   if(w.largestCounterpartyShare>.5)counterEvidence.push('往來集中於少數對手，大額玩家或固定代理關係也可能形成此結構');
   if(classification==='one_way_supplier'){evidence.push(`出幣服務 ${w.outCounterparties} 個對手、入幣來自 ${w.inCounterparties} 個對手，對同一對手雙向往來較少；判讀依對手方向結構，非淨流量`);counterEvidence.push('單向分發也可能是活動派發、獎勵、供應代理或測試；不同收贈對手不證明同幣傳遞或售幣');}
   if(classification==='possible_subhub')counterEvidence.push(linked?'共享對手或互轉不代表同一公司、同一控制人或正式分庫':'缺乏穩定主要中介候選關係；暫稱次級中介線索，不確認分庫');
   if(largestShared?.count)evidence.push(`與主要中介候選「${largestShared.hubNickname}」共享 ${largestShared.count} 個對手（不揭露一般對手名單）`);
   if(transferCoins>0)evidence.push(`與主要中介候選互轉佔本帳號週往來 ${(transferShare*100).toFixed(1)}%`);
   if(observationKind==='concentrated_distribution'){evidence.push(`入幣來源 ${w.inCounterparties} 個、出幣去向 ${w.outCounterparties} 個，來源或回流高度集中`);counterEvidence.push('集中收幣再分發可能是團體分配、活動或代理，不證明正式分庫或同一筆金幣的傳遞');}
   if(observationKind==='relay_link'){evidence.push('與集中收幣、多向派發的觀測帳號有直接雙向往來；保留必要連結供核對');counterEvidence.push('僅是靜態中轉連結，無逐筆先後；同詞暱稱、互轉與集中度不能證明主庫關係');}
   if(observationKind==='consolidating_settlement'){evidence.push(`從 ${coreInPeers} 個主要中介候選收幣，出幣集中在 ${w.outCounterparties} 個去向`);counterEvidence.push('多來源、少去向也可能是大戶代結算或玩家轉幣；缺乏面向多名玩家供幣的證據');}
   if(observationKind==='name_volume_insufficient'){evidence.push('暱稱含庫／金控字詞且往來量位於本站帳號前10%，但只有單一對手');counterEvidence.push('名稱及大額只作核對提示；單一對手、未見廣泛零售服務，不支持升為幣商候選');}
   if(todaySource)counterEvidence.push(`${asOf} 當日未結交易獨立列示，不加入完整日活躍天數`);
   selected.push({aid:account.aid,nickname:account.nickname,classification,observationKind,classificationLabel:{primary_intermediary:'主要中介特徵',possible_subhub:linked?'可能次級中介／分庫':'次級中介線索（未證分庫）',one_way_supplier:'方向型服務線索（供幣／派發待區分）',watch:{concentrated_distribution:'集中收幣／多向派發線索',relay_link:'集中中轉連結（待核對）',consolidating_settlement:'多來源集中結算（待核對）',name_volume_insufficient:'名稱／大額不足以確認'}[observationKind]??'待觀察／大額玩家反證'}[classification],confidence,weekly:w,daily,hubRelations:{transferShare,transferCoins,sharedCounterparties:shared.filter(s=>s.count>0),observedSubgroup:null},evidence,counterEvidence,verified:false,includeInRevenue:false});
  }
  const selectedIds=new Set(selected.map(c=>c.aid)),byAid=new Map(selected.map(c=>[c.aid,c])),parent=new Map(selected.map(c=>[c.aid,c.aid]));
  const find=id=>{while(parent.get(id)!==id)id=parent.get(id);return id;},join=(a,b)=>{const x=find(a),y=find(b);if(x!==y)parent.set(y,x);};
  for(const e of weekly.edges.values())if(e.coins>0&&e.fromAid!==e.toAid&&selectedIds.has(e.fromAid)&&selectedIds.has(e.toAid)){const fromAccount=network.get(e.fromAid),toAccount=network.get(e.toAid);result.edges.push({fromAid:e.fromAid,toAid:e.toAid,coins:e.coins,period:'weekly',shareOfFromOut:ratio(e.coins,fromAccount.out),shareOfToIn:ratio(e.coins,toAccount.in),mutual:(weekly.edges.get(edgeKey(e.toAid,e.fromAid))?.coins??0)>0});join(e.fromAid,e.toAid);}
  for(const c of selected)for(const s of c.hubRelations.sharedCounterparties)if(selectedIds.has(s.hubAid)&&s.count>=3&&s.jaccard>=.1&&s.overlapOfCandidate>=.25)join(c.aid,s.hubAid);
  const clusters=new Map();for(const c of selected){const root=find(c.aid);if(!clusters.has(root))clusters.set(root,[]);clusters.get(root).push(c.aid);}
  for(const members of clusters.values())if(members.length>1){const id='observed-'+(result.observedSubgroups.length+1);result.observedSubgroups.push({id,hubAids:members.filter(a=>coreIds.has(a)),memberAids:members,interpretation:'僅表示互轉或共享對手連結的觀測群，不代表同一實控人、公司或正式分庫'});for(const aid of members)byAid.get(aid).hubRelations.observedSubgroup=id;}
  const order={strong:0,moderate:1,weak:2};selected.sort((a,b)=>order[a.confidence]-order[b.confidence]||b.weekly.uniqueCounterparties-a.weekly.uniqueCounterparties||b.weekly.turnover-a.weekly.turnover);
  result.candidates=selected.filter(c=>c.classification!=='watch');result.weakEvidence=selected.filter(c=>c.classification==='watch');
  result.excludedProfiles={narrowHighVolumeAccounts:all.filter(a=>!selectedIds.has(a.aid)&&a.weekly.turnover>=threshold&&a.weekly.uniqueCounterparties<5).length,ordinaryAccountsNotOutput:all.length-selected.length};
  if(coverage.dailyWeeklyReconciliation.status==='pending'){
   const combined=new Map();for(const s of completed)for(const [key,e]of s.edges)combined.set(key,(combined.get(key)??0)+e.coins);let mismatched=0;for(const key of new Set([...combined.keys(),...weekly.edges.keys()]))if(Math.abs((combined.get(key)??0)-(weekly.edges.get(key)?.coins??0))>.01)mismatched++;
   coverage.dailyWeeklyReconciliation={status:mismatched?'mismatch':'match',checkedEdges:new Set([...combined.keys(),...weekly.edges.keys()]).size,mismatchedEdges:mismatched,note:'只有整週與逐日均為完整已結日且期間一致時，才檢查單向金幣量對平；差額不作交易量。'};
  }
  platforms.push(result);
 }
 return{schema:1,generatedAt:new Date().toISOString(),asOf,timezone:'Asia/Taipei',platforms,definitions:{direction:'每個from→to的單向贈禮總金額只計一次；反向是另一條邊，delta僅核對淨額。',identity:'所有角色均是交易網路候選，身分尚未確認；名稱、總量、互轉或共享對手均不能單獨證明幣商或同一實控人。',classification:'主要中介：對手≥20、雙向≥5、最大對手≤50%。次級線索：對手≥8、雙向≥2，且共享核心對手≥3及重疊≥25%或互轉≥20%，或最大對手≤65%；無核心連結時不稱分庫。方向型服務：出幣對手≥10、入幣對手≤出幣對手一半、雙向對手≤出幣對手20%、最大對手≤50%；不要求淨流出。弱證據中轉：集中派發為出幣對手≥10、入幣來源≤2、最大對手>50%，且入出皆有；其直接雙向來源且自身集中度≥50%另列連結；集中結算為≥3核心入幣來源、只有1個非核心出幣去向、無雙向對手且出／入幣量比介於0.5–2；僅向多家核心買賣幣不符合此中轉規則。名稱大額反證為庫／金控詞、單一對手、本站往來前10%，絕不升主候選。其他弱證據為對手≥5、雙向≥2且有核心連結或最大對手≥50%。這些是篩查規則，不是身分機率。',confidence:'strong只表示主要中介形狀兼具完整區間至少3日活躍、無缺完整日或重複明細新鮮度疑點；moderate表示結構線索而持續性較弱或角色不明；weak為中轉、名稱大額或玩家替代解釋的待核對觀測。全部身分尚未確認，非身分機率。',activeDays:'只計已取得、日期獨立驗證、完整且在採集時已結束的日報。缺日不是0，當日未結另列。',units:'各站原始金幣不可跨站合計，抽成、實際成交現金與現金營收未知；本模組不計營收。',privacy:'只輸出分級候選與候選間必要邊；一般對手僅提供數量、集中度與共享數，不提供完整帳號列。'}};
}

function derivedDailyWindow(platform,selected,asOf){
 const through=new Date(Date.parse(asOf)-86400000).toISOString().slice(0,10),from=new Date(Date.parse(asOf)-7*86400000).toISOString().slice(0,10),required=dates(from,through),sources=required.map(date=>selected.find(s=>s.platform===platform&&s.date===date&&s.archiveVerified===true&&s.complete&&!s.partial&&s.captureDate>date));
 if(sources.some(s=>!s))return{from,through,complete:false,missingDates:required.filter((_,i)=>!sources[i]),sourceReferences:sources.filter(Boolean).map(sourceMetadata),source:null};
 const edges=new Map(),names=new Map();for(const s of sources){for(const [aid,name]of s.names)names.set(aid,name);for(const [key,e]of s.edges){const old=edges.get(key);edges.set(key,{...e,coins:(old?.coins??0)+e.coins});}}
 for(const e of edges.values())e.delta=e.coins-(edges.get(edgeKey(e.toAid,e.fromAid))?.coins??0);
 const capturedAt=sources.map(s=>s.capturedAt).sort((a,b)=>Date.parse(b)-Date.parse(a))[0],sourceReferences=sources.map(s=>({...sourceMetadata(s),queryProof:{selectedFrom:s.date,selectedThrough:s.date,verified:s.dateProofVerified,freshResultVerified:s.freshResultVerified}}));
 const source={file:`derived-daily-window-${platform}-${from}_${through}`,platform,kind:'weekly',from,through,date:null,sourceUrl:'https://'+SITES[platform].host+'/statements/giving',capturedAt,captureDate:taipeiDay(capturedAt),sourceComplete:true,dateProofVerified:false,freshResultVerified:true,complete:true,partial:false,rowCount:edges.size,totalRows:null,issues:[],validation:{duplicatePairs:0,invalidRows:0,netChecked:edges.size,netMatched:edges.size},edges,names,signature:createHash('sha256').update(JSON.stringify([...edges].sort(([a],[b])=>a.localeCompare(b)))).digest('hex'),derived:true,dataBasis:'derived_from_7_verified_closed_daily_rankings',sourceReferences};
 return{from,through,complete:true,missingDates:[],sourceReferences,source};
}

export async function buildCompetitorMerchantNetwork(liveDir,options={}){
 const names=(await fs.readdir(liveDir)).filter(f=>/^gift-network-week-(o8|aos|fcc|cgb|goldfun|o9)-.*\.json$|^gift-daily-rank-(o8|aos|fcc|cgb|goldfun|o9)-.*\.json$/.test(f)).sort(),reports=[],readErrors=[];
 for(const file of names)try{reports.push({file,data:JSON.parse((await fs.readFile(path.join(liveDir,file),'utf8')).replace(/^\uFEFF/,''))});}catch{readErrors.push({file,issue:'source_json_unreadable'});}
 const asOf=options.asOf??taipeiDay(new Date().toISOString()),recentFrom=new Date(Date.parse(asOf)-7*86400000).toISOString().slice(0,10),wanted=new Set(dates(recentFrom,asOf));
 for(const r of reports)if(r.file.startsWith('gift-network-week-'))for(const day of dates(r.data.from,r.data.through))wanted.add(day);
 // The independently stored immutable snapshot is the source. The mutable index
 // is not a completeness or amount proof, and a same-day flat mirror is never
 // added to it a second time.
 const {validateCompetitorRank}=await import('./competitor-archive-store.mjs');
 const daily=new Map();for(const r of reports.filter(r=>r.file.startsWith('gift-daily-rank-'))){const p=parseCompetitorNetworkSource(r.file,r.data);if(p.complete){const site=SITES[p.platform],strict=site&&validateCompetitorRank(r.data,{key:p.platform,url:'https://'+site.host}).valid;daily.set(p.platform+'|'+p.date,{...r,archiveVerified:strict===true});}}
 for(const [platform,site]of Object.entries(SITES)){const root=path.join(liveDir,'competitor-archive',platform,'daily');let folders=[];try{folders=await fs.readdir(root,{withFileTypes:true});}catch(error){if(error.code!=='ENOENT')readErrors.push({file:`competitor-archive/${platform}/daily`,issue:'source_directory_unreadable'});}
  for(const folder of folders.filter(d=>d.isDirectory()&&validDate(d.name)&&wanted.has(d.name))){let entries=[];try{entries=await fs.readdir(path.join(root,folder.name),{withFileTypes:true});}catch{continue;}
   for(const entry of entries.filter(f=>f.isFile()&&/^[A-Za-z0-9-]+\.json$/.test(f.name))){const physical=`competitor-archive/${platform}/daily/${folder.name}/${entry.name}`,file=`gift-daily-rank-${platform}-${folder.name}.json`;try{const data=JSON.parse((await fs.readFile(path.join(root,folder.name,entry.name),'utf8')).replace(/^\uFEFF/,'')),validation=validateCompetitorRank(data,{key:platform,url:'https://'+site.host});if(!validation.valid||data.from!==folder.name||data.through!==folder.name||taipeiDay(data.capturedAt)>asOf){readErrors.push({file:physical,issue:'archive_source_unverified'});continue;}const key=platform+'|'+folder.name,old=daily.get(key);if(!old||Date.parse(data.capturedAt)>Date.parse(old.data.capturedAt)||Date.parse(data.capturedAt)===Date.parse(old.data.capturedAt)&&!old.archiveVerified)daily.set(key,{file,data,physicalFile:physical,archiveVerified:true});}catch{readErrors.push({file:physical,issue:'source_json_unreadable'});}}
  }
 }
 const selected=[...reports.filter(r=>!r.file.startsWith('gift-daily-rank-')),...daily.values()],parsed=selected.map(r=>({...parseCompetitorNetworkSource(r.file,r.data),physicalFile:r.physicalFile,archiveVerified:r.archiveVerified})),windows=new Map();
 for(const platform of Object.keys(SITES)){const window=derivedDailyWindow(platform,parsed,asOf);windows.set(platform,window);if(window.source)parsed.push(window.source);}
 const result=analyzeParsedNetworks(parsed,{...options,asOf});
 for(const p of result.platforms){const {source,...window}=windows.get(p.platform);p.coverage.latestClosedWindow=window;}
 return{...result,sourceReadErrors:readErrors};
}
