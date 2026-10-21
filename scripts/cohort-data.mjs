import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {adjacentMonth} from './payment-structure.mjs';
import {CONFIRMED_MERCHANTS,merchantConfirmation} from './merchant-identities.mjs';
import {parseMerchantParticipantSnapshot,loadCoinConversionPolicy,convertCoins} from './coin-conversion.mjs';
import {loadRankingSources,sourceReference} from './detail-source-selection.mjs';
const numeric=v=>{const text=String(v??'').trim();if(!/^(?:\d+|\d{1,3}(?:,\d{3})+)(?:\.\d+)?$/.test(text))throw Error('無效金額');const n=Number(text.replaceAll(',',''));if(!Number.isFinite(n)||n<0)throw Error('無效金額');return n;};
export function rankMap(snapshot){
 if(snapshot?.complete!==true)throw Error('儲值排行尚未完整');
 const explicit=Array.isArray(snapshot.header),header=explicit?snapshot.header:snapshot.rows?.[0],rows=explicit?snapshot.rows:snapshot.rows?.slice(1);
 if(!Array.isArray(header)||!Array.isArray(rows))throw Error('排行來源缺必要欄或資料列');
 const labels=header.map(h=>String(h??'').trim()),column=name=>{const positions=labels.flatMap((label,i)=>label===name?[i]:[]);if(positions.length!==1)throw Error('排行缺必要欄或欄名重複 '+name);return positions[0];};
 const ai=column('AID'),ni=column('暱稱'),ci=column('儲值金額'),li=labels.indexOf('最後操作時間'),out=new Map();let total=0;
 for(const row of rows){
  if(!Array.isArray(row))throw Error('排行資料列格式不符');
  const rawAid=row[ai],aid=rawAid==null?'':String(rawAid).trim();
  if(!aid||(typeof rawAid==='number'&&!Number.isSafeInteger(rawAid)))throw Error('排行 AID 無效');
  if(out.has(aid))throw Error('排行 AID 重複 '+aid);
  const cash=numeric(row[ci]);total+=cash;
  out.set(aid,{aid,name:row[ni]==null?null:String(row[ni]),cash,lastAction:li<0||row[li]==null||row[li]===''?null:String(row[li])});
 }
 if(snapshot.validation?.matching===false)throw Error('排行驗證總額不符');
 for(const field of ['rankingDeposit','dailyDeposit'])if(Object.hasOwn(snapshot.validation??{},field)){
  const expected=numeric(snapshot.validation[field]);if(Math.abs(total-expected)>.01)throw Error('排行驗證總額不符 '+field);
 }
 return out;
}
export function parseTransfers(snapshot){const header=snapshot.header||snapshot.rows[0],rows=snapshot.header?snapshot.rows:snapshot.rows.slice(1);const col=name=>{const i=header.indexOf(name);if(i<0)throw Error('交易來源缺欄 '+name);return i;};const indexes=['交易完成時間','贈禮AID','對象AID','贈禮金額','贈禮狀態'].map(col),gn=header.indexOf('贈禮暱稱'),rn=header.indexOf('對象暱稱');return rows.map(r=>({date:r[indexes[0]],giver:String(r[indexes[1]]),receiver:String(r[indexes[2]]),giverName:gn>=0?String(r[gn]??''):null,receiverName:rn>=0?String(r[rn]??''):null,amount:numeric(r[indexes[3]]),status:r[indexes[4]]}));}
function flowMap(transfers,month,through,platform='win'){const merchants=new Set(CONFIRMED_MERCHANTS[platform]??[]),result=new Map();for(const t of transfers){if(t.status!=='成功'||!String(t.date).startsWith(month)||t.date.slice(0,10)>through)continue;const from=merchants.has(t.giver),to=merchants.has(t.receiver);if(from===to)continue;const aid=from?t.receiver:t.giver,v=result.get(aid)||{received:0,returned:0};v[from?'received':'returned']+=t.amount;v.name=(from?t.receiverName:t.giverName)||v.name||null;result.set(aid,v);}return result;}
const period=s=>Array.isArray(s.period)?{from:s.period[0],to:s.period[1]}:s.period;
const taipeiDay=value=>new Date(Date.parse(value)+8*3600000).toISOString().slice(0,10),todayTaipei=()=>taipeiDay(new Date().toISOString());
const windowFor=(windows,platform,from,through)=>windows.filter(w=>w.platform===platform&&CONFIRMED_MERCHANTS[platform]?.length&&w.complete===true&&w.covered===true&&w.from===from&&w.through===through&&w.participants instanceof Map).sort((a,b)=>Date.parse(b.capturedAt)-Date.parse(a.capturedAt))[0]??null;
const merchantRef=w=>({file:w.sourceFiles?.[0],capturedAt:w.capturedAt,from:w.from,through:w.through,period:{from:w.from,through:w.through},complete:true,valid:true,role:'confirmed_merchant_flow',identityStatus:'confirmed_by_user'});
/** Period pair totals are not allocated to days or treated as cash receipts. */
export function parseCohortMerchantWindow(raw,file,{today=todayTaipei()}={}){
 const parsed=parseMerchantParticipantSnapshot(raw,file),issues=[...(parsed.validation?.reasons??[])],reject=code=>{if(!issues.includes(code))issues.push(code);},q=raw?.queryProof,p=raw?.paginationProof,n=raw?.totalRows,rows=raw?.rows??[],size=p?.pageSize,rank=raw?.header?.indexOf('名次')??-1;
 if(q?.verified!==true||q.selectedFrom!==parsed.from||q.selectedThrough!==parsed.through||q.aidFiltersEmpty===false||q.freshResultVerified===false)reject('merchant_query_unverified');
 if(raw.currentDayPartial===true||raw.partial===true)reject('merchant_contains_unclosed_day');
 if(q?.baselineSignature&&q?.resultSignature&&q.baselineSignature===q.resultSignature)reject('merchant_unchanged_result_unverified');
 if(JSON.stringify(raw?.header)!==JSON.stringify(['名次','贈禮AID','贈禮暱稱','對象AID','對象暱稱','贈禮總金額','差額'])||rows.some(r=>!Array.isArray(r)||r.length!==7))reject('merchant_report_columns_invalid');
 if(!Number.isFinite(Date.parse(raw?.capturedAt))||taipeiDay(raw.capturedAt)>today)reject('merchant_capture_after_asof');
 if(!Number.isSafeInteger(n)||n<0||n!==rows.length||!Number.isSafeInteger(size)||size<1||p?.totalRows!==n||!Array.isArray(p.pages)||p.pages.length!==Math.max(1,Math.ceil(n/size))||rank<0)reject('merchant_pagination_not_verified');
 else for(const [i,page]of p.pages.entries()){
  const slice=rows.slice(i*size,(i+1)*size),sequence=start=>slice.every((r,j)=>/^\d+$/.test(String(r[rank]))&&Number(r[rank])===start+j),global=sequence(i*size+1),proof=page.selectedPageProof,local=i>0&&sequence(1)&&page.selectedPageVerified===true&&proof?.verified===true&&proof.page===i+1&&proof.method==='observed_active_pagination_control'&&((proof.attribute==='aria-current'&&['true','page'].includes(proof.value))||(proof.attribute==='aria-pressed'&&proof.value==='true'));
  if(page.page!==i+1||page.rowCount!==Math.min(size,Math.max(0,n-i*size))||!global&&!local||slice.length&&(Number(page.firstRank)!==Number(slice[0][rank])||Number(page.lastRank)!==Number(slice.at(-1)[rank]))||i>0&&page.selectedPageVerified!==true||page.rowSha256&&page.rowSha256!==createHash('sha256').update(JSON.stringify(slice)).digest('hex'))reject('merchant_pagination_not_verified');
 }
 if(n===0&&q?.emptyResultVerified!==true)reject('merchant_empty_unverified');
 if(parsed.validation?.duplicatePairs>0)reject('merchant_duplicate_pair');
 if(issues.length)return{...parsed,complete:false,covered:false,participants:null,validation:{...parsed.validation,valid:false,reasons:issues}};
 const giver=raw.header.indexOf('贈禮AID'),receiver=raw.header.indexOf('對象AID'),giverName=raw.header.indexOf('贈禮暱稱'),receiverName=raw.header.indexOf('對象暱稱'),merchants=new Set(parsed.merchantIDs);
 for(const row of rows){const from=String(row[giver]),to=String(row[receiver]);if(merchants.has(from)===merchants.has(to))continue;const aid=merchants.has(from)?to:from,value=parsed.participants.get(aid);if(value)value.name=String(row[merchants.has(from)?receiverName:giverName]??'')||null;}
 return parsed;
}
export async function loadCohortMerchantWindows(live,{today=todayTaipei()}={}){const out=[];for(const file of(await fs.readdir(live)).filter(f=>/^gift-rank-[a-z0-9]+-\d{4}-\d{2}-\d{2}_\d{4}-\d{2}-\d{2}\.json$/.test(f))){try{const raw=JSON.parse((await fs.readFile(path.join(live,file),'utf8')).replace(/^\uFEFF/,''));out.push(parseCohortMerchantWindow(raw,file,{today}));}catch{out.push({sourceFiles:[file],complete:false,covered:false,validation:{valid:false,reasons:['merchant_source_unreadable']}});}}return out;}
function paymentEvidence(member,current,{platform,pw=null,cw=null,pf=pw?.participants,cf=cw?.participants,previousMerchantCovered=!!pw,currentMerchantCovered=!!cw,policy=null}={}){
 const aid=member?.aid??current?.aid,prevCash=member?.cash??0,currentCash=current?.cash??0,pre=pf?.get(aid),cur=cf?.get(aid),prevCoins=previousMerchantCovered?(pre?.received??0):null,currentCoins=currentMerchantCovered?(cur?.received??0):null,prevReturned=previousMerchantCovered?(pre?.returned??0):null,currentReturned=currentMerchantCovered?(cur?.returned??0):null,merchantCovered=previousMerchantCovered&&currentMerchantCovered,statusCode=currentCash>0?'official_repurchase':currentCoins>0?'merchant_only_repurchase':currentReturned>0?'selling_only':currentMerchantCovered?'no_funding_observed':'unknown',status={official_repurchase:'官儲回購',merchant_only_repurchase:'只買幣回購',selling_only:'仍賣幣',no_funding_observed:'官儲買幣皆未觀測',unknown:'官儲未觀測／幣商資料不足'}[statusCode],previousBuyAmount=convertCoins(prevCoins,platform,'buy',policy),currentBuyAmount=convertCoins(currentCoins,platform,'buy',policy),previousSellAmount=convertCoins(prevReturned,platform,'sell',policy),currentSellAmount=convertCoins(currentReturned,platform,'sell',policy);
 return{aid,name:current?.name||member?.name||cur?.name||pre?.name||null,prevCash,previousCash:prevCash,currentCash,cashDelta:currentCash-prevCash,cashDeltaPct:prevCash>0?(currentCash-prevCash)/prevCash:null,prevCoins,previousCoins:prevCoins,currentCoins,coinsDelta:merchantCovered?currentCoins-prevCoins:null,prevReturned,previousReturned:prevReturned,currentReturned,returnedDelta:merchantCovered?currentReturned-prevReturned:null,previousBuyAmount,prevBuyAmount:previousBuyAmount,currentBuyAmount,previousSellAmount,prevSellAmount:previousSellAmount,currentSellAmount,buyAmountDelta:previousBuyAmount!==null&&currentBuyAmount!==null?currentBuyAmount-previousBuyAmount:null,sellAmountDelta:previousSellAmount!==null&&currentSellAmount!==null?currentSellAmount-previousSellAmount:null,previousFundingAmount:previousBuyAmount!==null?prevCash+previousBuyAmount:null,currentFundingAmount:currentBuyAmount!==null?currentCash+currentBuyAmount:null,buyDivisor:policy?.rates?.[platform]?.buyDivisor??null,sellDivisor:policy?.rates?.[platform]?.sellDivisor??null,merchantCovered,previousMerchantCovered,currentMerchantCovered,previousPaid:prevCash>0,currentPaid:currentCash>0,previousFunded:prevCash>0?true:previousMerchantCovered?prevCoins>0:null,currentFunded:currentCash>0||currentCoins>0?true:currentMerchantCovered?false:null,directReturned:currentCash>0,merchantReturned:currentMerchantCovered?currentCoins>0:null,noPurchaseObserved:currentMerchantCovered?currentCash===0&&currentCoins===0:null,noRepurchase:currentMerchantCovered?currentCash===0&&currentCoins===0&&currentReturned===0:null,statusCode,status,membershipBasis:prevCash>0?'previous_official_payer':prevCoins>0?'previous_merchant_only_buyer':currentCash>0?'current_official_only':'current_merchant_observation',merchantIdentityStatus:CONFIRMED_MERCHANTS[platform]?.length?'confirmed_by_user':'unconfirmed_or_missing',merchantEvidenceBasis:'已確認幣商有向贈禮代理買賣方向；非已核對現金成交',lastActionAsOf:current?.lastAction||member?.lastAction||null,sepFullDeposit:prevCash,oct19Deposit:currentCash,sepFullMerchantReceived:prevCoins,oct19MerchantReceived:currentCoins,sepFullMerchantReturned:prevReturned,oct19MerchantReturned:currentReturned};
}
export function makeCohorts(rankings,transfers=[],merchantComplete=false,platform='win',{merchantWindows=[],policy=null,legacySources=[]}={}){
 const snapshots=[...rankings].sort((a,b)=>period(a).from.localeCompare(period(b).from)),cohorts=[];
 for(let i=1;i<snapshots.length;i++){
  const prev=snapshots[i-1],current=snapshots[i],p=period(prev),c=period(current),previous=p.from.slice(0,7),month=c.from.slice(0,7);
  if(!adjacentMonth(previous,month))continue;
  const previousMonthEnd=new Date(Date.UTC(Number(previous.slice(0,4)),Number(previous.slice(5)),0)).toISOString().slice(0,10);
  if(p.from!==previous+'-01'||p.to!==previousMonthEnd)continue;
  const pm=rankMap(prev),cm=rankMap(current);
  const legacyWindowCovered=range=>platform==='win'&&merchantComplete&&range.from>='2026-09-01'&&range.to<='2026-10-19'&&range.from.endsWith('-01');
  const findWindow=range=>windowFor(merchantWindows,platform,range.from,range.to);
  const pw=findWindow(p),cw=findWindow(c),previousMerchantCovered=!!pw||legacyWindowCovered(p),currentMerchantCovered=!!cw||legacyWindowCovered(c),merchantCovered=previousMerchantCovered&&currentMerchantCovered;
  const pf=pw?.participants??(legacyWindowCovered(p)?flowMap(transfers,previous,p.to,platform):null),cf=cw?.participants??(legacyWindowCovered(c)?flowMap(transfers,month,c.to,platform):null),legacyRefs=[p,c].filter((r,i)=>!(i?cw:pw)&&legacyWindowCovered(r)).flatMap(range=>legacySources.map(s=>({...s,period:{from:'2026-09-01',to:'2026-10-19'},derivedPeriod:range,complete:true,role:'verified_successful_transaction_subset'})));
  const excluded=new Set(CONFIRMED_MERCHANTS[platform]??[]),context={platform,pw,cw,pf,cf,previousMerchantCovered,currentMerchantCovered,policy},rows=[...pm.values()].filter(x=>x.cash>0&&!excluded.has(x.aid)).map(member=>paymentEvidence(member,cm.get(member.aid),context)).sort((a,b)=>b.prevCash-a.prevCash||a.aid.localeCompare(b.aid)),additionalMerchantOnlyRows=previousMerchantCovered?[...pf].filter(([aid,flow])=>flow.received>0&&!(pm.get(aid)?.cash>0)&&!excluded.has(aid)).map(([aid,flow])=>paymentEvidence({aid,name:flow.name,cash:0},cm.get(aid),context)).sort((a,b)=>b.prevCoins-a.prevCoins||a.aid.localeCompare(b.aid)):[];
  const monthLast=new Date(Number(month.slice(0,4)),Number(month.slice(5)),0).getDate();
  cohorts.push({platform,previous,current:month,cutoff:c.to,previousCutoff:p.to,previousBasis:'前月整月',currentBasis:Number(c.to.slice(8))===monthLast?'本月整月':'本月截至'+Number(c.to.slice(8))+'日',coverage:'rows保留前月整月官儲母體；additionalMerchantOnlyRows另列前月整月只向已確認幣商買幣者，不混換原母體。',merchantCovered,previousMerchantCovered,currentMerchantCovered,additionalMerchantOnlyCovered:previousMerchantCovered,additionalMerchantOnlyRows,merchantIDs:[...(CONFIRMED_MERCHANTS[platform]??[])],...merchantConfirmation(platform),merchantCoverage:merchantCovered?'前後期指定幣商金流各自完整覆蓋排行查詢期間':currentMerchantCovered?'僅本期指定幣商金流完整；前期保留未知，不計買幣差額':'本期指定幣商金流未取得相同完整期間，不可當成0。',sources:[{file:prev.sourceFile,capturedAt:prev.capturedAt,period:p,complete:prev.complete??null},{file:current.sourceFile,capturedAt:current.capturedAt,period:c,complete:current.complete??null},...[pw,cw].filter(Boolean).map(merchantRef),...legacyRefs],comparison:'前月整月對本月資料截止日；本月未滿整月時不表示確定流失。',rows});
 }
 return cohorts;
}
export async function buildCohorts(live,options={}){const read=async name=>{try{return JSON.parse((await fs.readFile(path.join(live,name),'utf8')).replace(/^\uFEFF/,''));}catch(e){if(e.code==='ENOENT')return null;throw e;}};
 const byPlatform=new Map(),selection=options.selection??await loadRankingSources(live,options),policy=options.policy??await loadCoinConversionPolicy();
 for(const selected of selection.selected){const list=byPlatform.get(selected.platform)||[];list.push({...selected.snapshot,sourceFile:selected.file});byPlatform.set(selected.platform,list);}
 let filesComplete=true;const out=[],legacySources=[];for(const name of ['merchant-out-2026-09-01_2026-10-19-page1.json','merchant-out-2026-09-01_2026-10-19-page2.json']){const source=await read(name);if(source){out.push(...parseTransfers(source));legacySources.push({file:name,capturedAt:source.capturedAt});}else filesComplete=false;}const incomingFile='merchant-in-2026-09-01_2026-10-19-page1.json',incomingSource=await read(incomingFile);if(!incomingSource)filesComplete=false;else legacySources.push({file:incomingFile,capturedAt:incomingSource.capturedAt});const incoming=incomingSource?parseTransfers(incomingSource):[];
 const sum=rows=>rows.reduce((s,r)=>s+r.amount,0),merchants=new Set(CONFIRMED_MERCHANTS.win);const merchantComplete=filesComplete&&out.length===1737&&incoming.length===321&&Math.abs(sum(out)-4014950)<0.01&&Math.abs(sum(incoming)-4730916)<0.01&&[...out,...incoming].every(r=>r.status==='成功'&&/^2026-(09|10)-\d{2} \d{2}:\d{2}:\d{2}$/.test(r.date)&&r.date.slice(0,10)>='2026-09-01'&&r.date.slice(0,10)<='2026-10-19')&&out.every(r=>merchants.has(r.giver)&&!merchants.has(r.receiver))&&incoming.every(r=>merchants.has(r.receiver)&&!merchants.has(r.giver));
 const merchantWindows=options.merchantWindows??await loadCohortMerchantWindows(live,options);
 return [...byPlatform].flatMap(([platform,rankings])=>makeCohorts(rankings,[...out,...incoming],merchantComplete,platform,{merchantWindows,policy,legacySources}));
}

// A separate union of the two exact same-day payer lists. The main cohorts keep
// their previous-full-month base, so these rows never replace that churn base.
export function samePeriodPayerComparisons(selection,{merchantWindows=[],policy=null}={}){
 const records=[...selection.selected,...selection.comparisonSources],output=[];
 for(const current of selection.selected){const p=current.period,priorDate=new Date(p.from);priorDate.setUTCMonth(priorDate.getUTCMonth()-1);const pm=priorDate.toISOString().slice(0,7),monthEnd=month=>new Date(Date.UTC(+month.slice(0,4),+month.slice(5),0)).toISOString().slice(0,10),previousThrough=p.through===monthEnd(current.month)?monthEnd(pm):pm+'-'+p.through.slice(8),previous=records.filter(r=>r.platform===current.platform&&r.period.from===pm+'-01'&&r.period.through===previousThrough).sort((a,b)=>(Date.parse(b.snapshot.capturedAt)||0)-(Date.parse(a.snapshot.capturedAt)||0))[0];
  if(!previous)continue;const platform=current.platform,pw=windowFor(merchantWindows,platform,previous.period.from,previous.period.through),cw=windowFor(merchantWindows,platform,p.from,p.through),excluded=new Set(CONFIRMED_MERCHANTS[platform]??[]),ids=new Set([...previous.map.keys(),...current.map.keys(),...(pw?.participants.keys()??[]),...(cw?.participants.keys()??[])]),rows=[...ids].filter(aid=>!excluded.has(aid)).map(aid=>paymentEvidence(previous.map.get(aid)??{aid,cash:0},current.map.get(aid),{platform,pw,cw,policy})).filter(r=>r.previousPaid||r.currentPaid||r.prevCoins>0||r.currentCoins>0||r.prevReturned>0||r.currentReturned>0).sort((a,b)=>b.previousCash-a.previousCash||(b.prevCoins??0)-(a.prevCoins??0)||a.aid.localeCompare(b.aid)),merchantSources=[pw,cw].filter(Boolean).map(merchantRef);
  output.push({platform,previous:pm,current:current.month,from:p.from,through:p.through,prevFrom:previous.period.from,prevThrough:previous.period.through,complete:true,cashComplete:true,previousMerchantCovered:!!pw,currentMerchantCovered:!!cw,merchantCovered:!!pw&&!!cw,merchantIdentityStatus:CONFIRMED_MERCHANTS[platform]?.length?'confirmed_by_user':'unconfirmed_or_missing',...merchantConfirmation(platform),basis:'前後月精確同期官儲與已確認幣商交易AID聯集；含僅買幣者，賣幣另列；不替代前月整月母體。缺幣商來源時不判兩通路皆無。',sourceFiles:[previous.file,current.file,...merchantSources.map(s=>s.file)],sources:[sourceReference(previous),sourceReference(current),...merchantSources],merchantSources,rows});
 }
 return output;
}
export async function buildSamePeriodPayerComparisons(live,options={}){return samePeriodPayerComparisons(await loadRankingSources(live,options),{merchantWindows:await loadCohortMerchantWindows(live,options),policy:options.policy??await loadCoinConversionPolicy()});}
export async function buildCohortData(live,options={}){
 const selection=await loadRankingSources(live,options),merchantWindows=await loadCohortMerchantWindows(live,options),policy=options.policy??await loadCoinConversionPolicy(),cohorts=await buildCohorts(live,{...options,selection,merchantWindows,policy}),gaps=[...selection.domainCoverage.gaps];
 for(const current of selection.selected){const prior=new Date(current.period.from);prior.setUTCMonth(prior.getUTCMonth()-1);const month=prior.toISOString().slice(0,7),previous=selection.selected.find(r=>r.platform===current.platform&&r.month===month);if(previous&&previous.period.through!==new Date(Date.UTC(Number(month.slice(0,4)),Number(month.slice(5)),0)).toISOString().slice(0,10))gaps.push({platform:current.platform,month:current.month,file:previous.file,reason:'previous_full_month_base_not_available',issues:['previous_full_month_base_not_available']});}
 return{cohorts,samePeriodComparisons:samePeriodPayerComparisons(selection,{merchantWindows,policy}),domainCoverage:{...selection.domainCoverage,module:'cohorts',gaps,merchantSources:merchantWindows.map(w=>({platform:w.platform,from:w.from,through:w.through,file:w.sourceFiles?.[0],capturedAt:w.capturedAt,complete:w.complete===true,valid:w.validation?.valid===true,issues:w.validation?.reasons??[]}))}};
}
