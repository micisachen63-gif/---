import fs from 'node:fs/promises';
import path from 'node:path';
import {MERCHANT_IDENTITY_REGISTRY,merchantConfirmation} from './merchant-identities.mjs';

const columns=['贈禮AID','贈禮暱稱','對象AID','對象暱稱','贈禮總金額','差額'];
const finite=value=>{const text=String(value??'').trim().replaceAll(',','');return /^-?\d+(?:\.\d+)?$/.test(text)&&Number.isFinite(Number(text))?Number(text):null;};
const isoDate=value=>/^\d{4}-\d{2}-\d{2}$/.test(String(value??''))&&Number.isFinite(Date.parse(value))&&new Date(value).toISOString().slice(0,10)===value?value:null;
const namesignal=name=>['金庫','金控'].filter(word=>String(name).includes(word));
const sum=items=>items.reduce((s,v)=>s+v,0);
const scopeDays=(from,through)=>from&&through?Math.round((Date.parse(through)-Date.parse(from))/86400000)+1:null;
function sourceInfo(file,d){return{file,sourceUrl:d.sourceUrl??null,capturedAt:d.capturedAt??null,complete:typeof d.complete==='boolean'?d.complete:null,totalRows:finite(d.totalRows),rowCount:Array.isArray(d.rows)?d.rows.length:null,recentOnlyRestriction:d.recentOnlyRestriction??null,tab:d.tab??null,header:d.header??null};}

export function analyzeGiftReports(reports){
 const groups=new Map(),unusableSources=[];
 for(const {file,data:d} of reports){
  const platform=d.platform??null,from=isoDate(d.from??d.period?.from),through=isoDate(d.through??d.period?.through??d.period?.to);
  if(!platform||!from||!through||from>through){unusableSources.push({...sourceInfo(file,d),reason:'missing_platform_or_invalid_period'});continue;}
  const id=platform+'|'+from+'|'+through;if(!groups.has(id))groups.set(id,{platform,from,through,reports:[]});groups.get(id).reports.push({file,data:d});
 }
 const result=[];
 for(const group of groups.values()){
  const edges=new Map(),sources=[],invalidRows=[],conflicts=[],headerErrors=[];let duplicateRows=0;
  const ordered=[...group.reports].sort((a,b)=>String(b.data.capturedAt??'').localeCompare(String(a.data.capturedAt??''))||a.file.localeCompare(b.file));
  for(const {file,data:d} of ordered){
   const source=sourceInfo(file,d);sources.push(source);const header=d.header??[],idx=Object.fromEntries(columns.map(c=>[c,header.indexOf(c)]));
   if(columns.some(c=>idx[c]<0)||!Array.isArray(d.rows)){headerErrors.push({file,missingColumns:columns.filter(c=>idx[c]<0)});continue;}
   d.rows.forEach((row,rowIndex)=>{
    const from=String(row[idx['贈禮AID']]??'').trim(),to=String(row[idx['對象AID']]??'').trim(),amount=finite(row[idx['贈禮總金額']]),delta=finite(row[idx['差額']]);
    if(!from||!to||amount===null||amount<0){invalidRows.push({file,row:rowIndex+1,reason:'invalid_id_or_directed_give_amount'});return;}
    const edge={from,to,fromNickname:String(row[idx['贈禮暱稱']]??''),toNickname:String(row[idx['對象暱稱']]??''),amount,reportedDelta:delta,sourceFile:file,capturedAt:d.capturedAt??null},key=from+'>'+to;
    if(edges.has(key)){duplicateRows++;if(edges.get(key).amount!==amount)conflicts.push({from,to,keptSourceFile:edges.get(key).sourceFile,otherSourceFile:file});return;}edges.set(key,edge);
   });
  }
  const explicitComplete=sources.some(s=>s.complete===true&&s.rowCount!==null&&(s.totalRows===null||s.rowCount===s.totalRows));
  let complete=headerErrors.length||invalidRows.length||conflicts.length?false:explicitComplete?true:sources.some(s=>s.complete===false)?false:null;
  const accounts=new Map();
  function account(aid,nickname){if(!accounts.has(aid))accounts.set(aid,{aid,nickname,nicknames:new Set(),out:0,in:0,selfTransfers:0,peers:new Map()});const a=accounts.get(aid);if(nickname){a.nicknames.add(nickname);if(!a.nickname)a.nickname=nickname;}return a;}
  function peer(a,id){if(!a.peers.has(id))a.peers.set(id,{out:0,in:0});return a.peers.get(id);}
  const netChecks={checked:0,matched:0,mismatched:0,notCheckable:0};
  for(const edge of edges.values()){
   const a=account(edge.from,edge.fromNickname),b=account(edge.to,edge.toNickname),reverse=edges.get(edge.to+'>'+edge.from);
   if(edge.reportedDelta===null||(!reverse&&complete!==true))netChecks.notCheckable++;
   else{netChecks.checked++;if(Math.abs((edge.amount-(reverse?.amount??0))-edge.reportedDelta)<.01)netChecks.matched++;else netChecks.mismatched++;}
   if(edge.from===edge.to){a.selfTransfers+=edge.amount;continue;}
   if(edge.amount===0)continue;
   a.out+=edge.amount;b.in+=edge.amount;peer(a,b.aid).out+=edge.amount;peer(b,a.aid).in+=edge.amount;
  }
  if(netChecks.mismatched)complete=false;
  const rows=[...accounts.values()].map(a=>{
   const peers=[...a.peers.values()],volume=a.out+a.in,shares=volume>0?peers.map(p=>(p.out+p.in)/volume):[];
   return{platform:group.platform,from:group.from,through:group.through,aid:a.aid,nickname:a.nickname,nicknames:[...a.nicknames],out:a.out,in:a.in,netIn:a.in-a.out,observedTurnover:volume,uniqueCounterparties:a.peers.size,outCounterparties:peers.filter(p=>p.out>0).length,inCounterparties:peers.filter(p=>p.in>0).length,bidirectionalCounterparties:peers.filter(p=>p.out>0&&p.in>0).length,concentration:{largestCounterpartyShare:shares.length?Math.max(...shares):null,hhi:shares.length?sum(shares.map(s=>s*s)):null},nameSignals:[...new Set([...a.nicknames].flatMap(namesignal))],selfTransfers:a.selfTransfers,verifiedMerchant:false,includeInRevenue:false};
  }).sort((a,b)=>b.observedTurnover-a.observedTurnover);
  rows.forEach((a,index)=>{
   const broad=a.uniqueCounterparties>=20?3:a.uniqueCounterparties>=10?2:a.uniqueCounterparties>=5?1:0,bidirectional=a.bidirectionalCounterparties>=5?2:a.bidirectionalCounterparties>=2?1:0,hasBoth=a.out>0&&a.in>0,diverse=a.uniqueCounterparties>=5&&a.concentration.largestCounterpartyShare<=.5,topVolume=rows.length>=10&&index<Math.ceil(rows.length*.1);
   a.score=(a.nameSignals.length?2:0)+broad+bidirectional+(hasBoth?1:0)+(diverse?1:0)+(topVolume?1:0);
   a.level=a.score>=7&&a.uniqueCounterparties>=5&&a.bidirectionalCounterparties>=2?'high':a.score>=4&&a.uniqueCounterparties>=3&&hasBoth?'medium':a.score>=2?'low':'observation';
   a.levelLabel={high:'優先核對',medium:'次優先核對',low:'弱線索',observation:'一般觀測'}[a.level];
   a.evidence=[`與 ${a.uniqueCounterparties} 個不同帳號往來（收 ${a.inCounterparties}／贈 ${a.outCounterparties}）`,`雙向往來 ${a.bidirectionalCounterparties} 個對手`,...(a.concentration.largestCounterpartyShare===null?[]:[`最大單一對手佔往來 ${(a.concentration.largestCounterpartyShare*100).toFixed(1)}%`]),...(a.nameSignals.length?[`暱稱含「${a.nameSignals.join('、')}」字詞`]:[]),...(topVolume?['觀測往來量位於本站帳號前 10%']:[])];
  });
  for(const identity of MERCHANT_IDENTITY_REGISTRY.platforms[group.platform]?.accounts??[]){
   let account=rows.find(a=>a.aid===identity.aid);
   if(!account){account={platform:group.platform,from:group.from,through:group.through,aid:identity.aid,nickname:identity.nickname,nicknames:[identity.nickname],in:0,out:0,netIn:0,observedTurnover:0,uniqueCounterparties:complete===true?0:null,outCounterparties:complete===true?0:null,inCounterparties:complete===true?0:null,bidirectionalCounterparties:complete===true?0:null,concentration:{largestCounterpartyShare:null,hhi:null},selfTransfers:0,score:null,evidence:[]};rows.push(account);}
   account.observedIn=account.in;account.observedOut=account.out;account.observedNickname=account.nickname;
   account.nickname=identity.nickname;account.amountsComplete=complete===true;account.capturedAt=sources.map(s=>s.capturedAt).filter(Boolean).sort().at(-1)??null;account.sourceFiles=sources.map(s=>s.file);account.sourceUrl=sources.find(s=>s.sourceUrl)?.sourceUrl??null;
   if(!account.amountsComplete){account.in=null;account.out=null;account.netIn=null;account.observedTurnover=null;}
   account.verifiedMerchant=true;account.identityStatus='confirmed_by_user';account.level='confirmed';account.levelLabel='正式幣商（使用者確認）';account.includeInRevenue=false;Object.assign(account,merchantConfirmation(group.platform));
   account.evidence=[...account.evidence,'使用者已確認此平台與AID為正式幣商',account.amountsComplete?'當期完整排行的原始收贈量；不是現金營收':'當期來源尚未完整核對；總收贈量保留未知'];
  }
  const confirmedMerchants=rows.filter(a=>a.verifiedMerchant);
  const candidates=rows.filter(a=>!a.verifiedMerchant&&a.level!=='observation').sort((a,b)=>b.score-a.score||b.observedTurnover-a.observedTurnover);
  result.push({platform:group.platform,from:group.from,through:group.through,month:group.through.slice(0,7),days:scopeDays(group.from,group.through),capturedAt:sources.map(s=>s.capturedAt).filter(Boolean).sort().at(-1)??null,sourceUrl:sources.find(s=>s.sourceUrl)?.sourceUrl??null,complete,recentOnlyRestriction:sources.some(s=>s.recentOnlyRestriction===true),sources,units:'後台原始金幣，未折台幣',directedEdges:edges.size,observedDirectedGive:sum([...edges.values()].filter(e=>e.from!==e.to).map(e=>e.amount)),accountCount:accounts.size,candidateCount:candidates.length,confirmedMerchantCount:confirmedMerchants.length,confirmedMerchants,candidates,accounts:rows,validation:{valid:!headerErrors.length&&!invalidRows.length&&!conflicts.length&&!netChecks.mismatched,duplicateRows,conflicts,invalidRows,headerErrors,netChecks},scopeNote:'候選只表示交易中介線索；已確認身分另依使用者確認清單列示，均不由此模組自動納入營收。單一帳號收＋贈是其觀測往來量，不能跨帳號加總成平台營收。'});
 }
 return{schema:1,generatedAt:new Date().toISOString(),groups:result.sort((a,b)=>a.platform.localeCompare(b.platform)||a.from.localeCompare(b.from)),candidates:result.flatMap(g=>g.candidates),confirmedMerchants:result.flatMap(g=>g.confirmedMerchants),unusableSources,definitions:{directedGive:'每個 from→to 的贈禮總金額只計一次；反向列是另一條邊。差額只用於雙向淨額核對。',counterparty:'收或贈金額大於零的不同帳號；不含自己。',concentration:'最大對手佔（收＋贈）比率與 HHI，皆在該觀測區間內計算。',levels:'評分使用名稱詞、對手廣度、雙向對手、分散度與觀測量排序；優先級不是已驗證身分或異常判定。',coverage:'complete 僅代表來源排行完整；不代表全年或整月覆蓋。缺失來源與反向列不補零。'}};
}

export async function buildMerchantCandidates(liveDir){
 const files=(await fs.readdir(liveDir)).filter(f=>/^gift-rank-.*\.json$/.test(f)).sort(),reports=[];
 for(const file of files){const data=JSON.parse((await fs.readFile(path.join(liveDir,file),'utf8')).replace(/^\uFEFF/,''));reports.push({file,data});}
 return analyzeGiftReports(reports);
}
