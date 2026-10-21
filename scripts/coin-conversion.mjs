import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {MERCHANT_IDENTITY_REGISTRY,CONFIRMED_MERCHANTS,MERCHANT_PLATFORM_ORDER,merchantConfirmation} from './merchant-identities.mjs';
export {MERCHANT_IDENTITY_REGISTRY,CONFIRMED_MERCHANTS} from './merchant-identities.mjs';

const DEFAULT_FILE=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../config/merchant-rates.json');
export const CONVERSION_DEFINITION='收贈禮買幣／賣幣金幣依使用者指定除數換算（coins/divisor），是估算金額，尚未核對實際成交現金；生效日未提供（effectiveFrom=null），不能視為已確認歷史成交匯率。不適用官儲、遊戲投注／損益、RTP或活動發幣。未設定匯率或原始金幣未知時為null；已知0維持0，原始金幣不變，僅顯示時四捨五入。';
export const REVENUE_DEFINITION='營收＝同期間官儲＋買幣換算金額－賣幣換算金額。使用者指定營收口徑，非扣除活動及營運成本後淨利；不得當已核對成交現金。三項原始資料須全部有效且已知、買賣除數皆已設定，缺少任一項則為null，已知0可計算，負營收可保留；生效日未知，不能視為已確認歷史成交匯率。';

export function validateCoinConversionPolicy(policy){
 if(policy?.schema!==1||policy.method!=='coins/divisor'||!policy.rates||typeof policy.rates!=='object'||Array.isArray(policy.rates))throw Error('買賣幣換算設定格式不符');
 for(const [platform,rate]of Object.entries(policy.rates)){
  for(const key of ['buyDivisor','sellDivisor'])if(typeof rate?.[key]!=='number'||!Number.isFinite(rate[key])||rate[key]<=0)throw Error('買賣幣除數無效：'+platform+'/'+key);
 }
 return policy;
}
export async function loadCoinConversionPolicy(filename=DEFAULT_FILE){return validateCoinConversionPolicy(JSON.parse((await fs.readFile(filename,'utf8')).replace(/^\uFEFF/,'')));}

export function convertCoins(coins,platform,direction,policy){
 if(policy?.method!=='coins/divisor')return null;
 if(typeof coins!=='number'||!Number.isFinite(coins)||coins<0)return null;
 const key=direction==='buy'?'buyDivisor':direction==='sell'?'sellDivisor':null;
 const divisor=key?policy?.rates?.[platform]?.[key]:null;
 if(typeof divisor!=='number'||!Number.isFinite(divisor)||divisor<=0)return null;
 return coins/divisor;
}
export function revenueAmount(directCash,buyCoins,sellCoins,platform,policy){
 if(typeof directCash!=='number'||!Number.isFinite(directCash)||directCash<0)return null;
 const buy=convertCoins(buyCoins,platform,'buy',policy),sell=convertCoins(sellCoins,platform,'sell',policy);
 return buy===null||sell===null?null:directCash+buy-sell;
}
export function addFundingConversion(funding,policy){
 return funding.map(row=>({...row,
  buyAmount:convertCoins(row.buyCoins,row.platform,'buy',policy),
  sellAmount:convertCoins(row.sellCoins,row.platform,'sell',policy),
  prevBuyAmount:convertCoins(row.prevBuyCoins,row.platform,'buy',policy),
  prevSellAmount:convertCoins(row.prevSellCoins,row.platform,'sell',policy),
  revenueAmount:row.covered===false?null:revenueAmount(row.directCash,row.buyCoins,row.sellCoins,row.platform,policy),
  prevRevenueAmount:row.previousMerchantCovered===false?null:revenueAmount(row.prevDirectCash,row.prevBuyCoins,row.prevSellCoins,row.platform,policy)
 }));
}

const MERCHANTS=new Set(CONFIRMED_MERCHANTS.win);
const PAIR_HOSTS=Object.fromEntries(Object.entries(MERCHANT_IDENTITY_REGISTRY.platforms).map(([key,value])=>[key,value.host]));
const MERCHANT_FILES={buy:['merchant-out-2026-09-01_2026-10-19-page1.json','merchant-out-2026-09-01_2026-10-19-page2.json'],sell:['merchant-in-2026-09-01_2026-10-19-page1.json']};
export function parseMerchantSnapshot(snapshot,direction){
 const header=snapshot.header||snapshot.rows?.[0],rows=snapshot.header?snapshot.rows:snapshot.rows?.slice(1);
 if(!header||!rows)throw Error('收贈禮來源格式不符');
 const indexes=['交易完成時間','贈禮AID','對象AID','贈禮金額','贈禮狀態'].map(label=>{const i=header.indexOf(label);if(i<0)throw Error('收贈禮來源缺少 '+label);return i;});
 return rows.map(row=>{
  const [date,giver,receiver,amount,status]=indexes.map(i=>row[i]);
  const coins=Number(String(amount).replaceAll(',',''));
  if(!/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(date)||!Number.isFinite(coins)||coins<0||status!=='成功')throw Error('收贈禮完整成功交易驗證不符');
  if(direction==='buy'?(!MERCHANTS.has(String(giver))||MERCHANTS.has(String(receiver))):direction==='sell'?(!MERCHANTS.has(String(receiver))||MERCHANTS.has(String(giver))):true)throw Error('收贈禮方向或幣商不符');
  return {date:date.slice(0,10),completedAt:date,direction,coins};
 });
}
function dates(from,to){const out=[];for(let t=Date.parse(from+'T00:00:00Z');t<=Date.parse(to+'T00:00:00Z');t+=86400000)out.push(new Date(t).toISOString().slice(0,10));return out;}
function cashInRange(daily,from,to){const expected=dates(from,to),map=new Map(daily.map(r=>[r[0],r[4]]));return expected.length&&expected.every(d=>typeof map.get(d)==='number'&&Number.isFinite(map.get(d)))?expected.reduce((s,d)=>s+map.get(d),0):null;}
export function buildFundingDaily(transfers,coverage,daily,policy){
 if(coverage.complete!==true)throw Error('未驗證完整收贈禮覆蓋，不可補0');
 const map=new Map(dates(coverage.from,coverage.to).map(date=>[date,{platform:coverage.platform,date,buyCoins:0,sellCoins:0,covered:true,directCash:cashInRange(daily,date,date),source:'後台成功收贈禮紀錄，依交易完成日彙總',sourceUrl:coverage.sourceUrl,sourceFiles:coverage.sourceFiles,capturedAt:coverage.capturedAt}]));
 for(const t of transfers){const row=map.get(t.date);if(!row)throw Error('收贈禮完成日超出驗證覆蓋期間');row[t.direction==='buy'?'buyCoins':'sellCoins']+=t.coins;}
 return addFundingConversion([...map.values()],policy);
}
export function summarizeFundingMonths(fundingDaily,daily,policy){
 const sumCoins=(from,to,key)=>{const expected=dates(from,to),map=new Map(fundingDaily.map(r=>[r.date,r]));return expected.length&&expected.every(d=>map.get(d)?.covered===true)?expected.reduce((s,d)=>s+map.get(d)[key],0):null;};
 const periods=[{month:'2026-09',from:'2026-09-01',through:'2026-09-30',prevFrom:'2026-08-01',prevThrough:'2026-08-31',partial:false},{month:'2026-10',from:'2026-10-01',through:'2026-10-19',prevFrom:'2026-09-01',prevThrough:'2026-09-19',partial:true}];
 return addFundingConversion(periods.map(p=>({platform:'win',...p,to:p.through,directCash:cashInRange(daily,p.from,p.through),prevDirectCash:cashInRange(daily,p.prevFrom,p.prevThrough),buyCoins:sumCoins(p.from,p.through,'buyCoins'),sellCoins:sumCoins(p.from,p.through,'sellCoins'),prevBuyCoins:sumCoins(p.prevFrom,p.prevThrough,'buyCoins'),prevSellCoins:sumCoins(p.prevFrom,p.prevThrough,'sellCoins'),covered:sumCoins(p.from,p.through,'buyCoins')!==null,previousMerchantCovered:sumCoins(p.prevFrom,p.prevThrough,'buyCoins')!==null,source:'後台成功收贈禮完成日彙總；官儲為後台每日儲值同範圍加總',sourceFiles:[...MERCHANT_FILES.buy,...MERCHANT_FILES.sell]})),policy);
}

const numeric=value=>{const text=String(value??'').trim().replaceAll(',','');return /^-?\d+(?:\.\d+)?$/.test(text)&&Number.isFinite(Number(text))?Number(text):null;};
const validDate=value=>/^\d{4}-\d{2}-\d{2}$/.test(String(value??''))&&Number.isFinite(Date.parse(value))&&new Date(value).toISOString().slice(0,10)===value;
const monthEnd=month=>new Date(Date.UTC(Number(month.slice(0,4)),Number(month.slice(5,7)),0)).toISOString().slice(0,10);
function previousPeriod(from,through){const prior=new Date(from+'T00:00:00Z');prior.setUTCMonth(prior.getUTCMonth()-1);const prevFrom=prior.toISOString().slice(0,7)+'-01',end=monthEnd(prevFrom.slice(0,7));return{prevFrom,prevThrough:through===monthEnd(from.slice(0,7))?end:prevFrom.slice(0,8)+String(Math.min(Number(through.slice(8)),Number(end.slice(8)))).padStart(2,'0')};}

export function parseMerchantPairSnapshot(snapshot,sourceFile){
 const match=/^gift-rank-([a-z0-9]+)-(\d{4}-\d{2}-\d{2})_(\d{4}-\d{2}-\d{2})\.json$/.exec(sourceFile),platform=match?.[1]??snapshot.platform,from=snapshot.from,through=snapshot.through;
 const record={platform,from,through,to:through,month:validDate(from)?from.slice(0,7):null,merchantIDs:[...(CONFIRMED_MERCHANTS[platform]??[])],...merchantConfirmation(platform),capturedAt:snapshot.capturedAt??null,sourceUrl:snapshot.sourceUrl??null,sourceFiles:[sourceFile],queryProof:snapshot.queryProof??null,paginationProof:snapshot.paginationProof??null,source:'後台完整贈禮排行，已確認幣商有向pair原始金額',sourceReport:'贈禮排行',kind:'monthly_pair_ranking',complete:false,covered:false,buyCoins:null,sellCoins:null,sourceComplete:typeof snapshot.complete==='boolean'?snapshot.complete:null,validation:{valid:false,reasons:[],duplicatePairs:0,excludedMerchantPairs:0,excludedOrdinaryPairs:0,netChecks:{checked:0,matched:0,mismatched:0}}};
 const reject=reason=>record.validation.reasons.push(reason);
 if(!CONFIRMED_MERCHANTS[platform]?.length)reject('no_user_confirmed_merchants_for_platform');
 if(!match||snapshot.platform!==platform||from!==match?.[2]||through!==match?.[3])reject('filename_platform_or_period_mismatch');
 if(!validDate(from)||!validDate(through)||from>through||from?.slice(8)!=='01'||from?.slice(0,7)!==through?.slice(0,7))reject('requires_same_month_start_day_one');
 try{const u=new URL(snapshot.sourceUrl);if(u.protocol!=='https:'||u.host!==PAIR_HOSTS[platform]||u.pathname.replace(/\/$/,'')!=='/statements/giving'||u.username||u.password)reject('untrusted_source_url');}catch{reject('untrusted_source_url');}
 if(snapshot.tab!=='贈禮排行')reject('wrong_report_tab');
 if(snapshot.complete!==true)reject('source_not_complete');
 if(!snapshot.capturedAt||!Number.isFinite(Date.parse(snapshot.capturedAt)))reject('missing_capture_time');
 else if(validDate(through)&&through>=new Date(Date.parse(snapshot.capturedAt)+8*3600000).toISOString().slice(0,10))reject('query_end_not_closed_at_capture');
 if(snapshot.currentDayPartial===true)reject('source_contains_unclosed_day');
 if(snapshot.queryProof&&(snapshot.queryProof.verified!==true||snapshot.queryProof.selectedFrom!==from||snapshot.queryProof.selectedThrough!==through))reject('selected_dates_not_verified');
 const header=snapshot.header??[],required=['贈禮AID','對象AID','贈禮總金額','差額'],idx=Object.fromEntries(required.map(k=>[k,header.indexOf(k)]));
 if(required.some(k=>idx[k]<0)||!Array.isArray(snapshot.rows))reject('missing_pair_columns_or_rows');
 if(snapshot.totalRows!=null&&(numeric(snapshot.totalRows)===null||numeric(snapshot.totalRows)!==snapshot.rows?.length))reject('reported_row_count_mismatch');
 if(record.validation.reasons.length)return record;
 const pairs=new Map(),merchants=new Set(record.merchantIDs);let buy=0,sell=0;
 for(const row of snapshot.rows){
  const giver=String(row[idx['贈禮AID']]??'').trim(),receiver=String(row[idx['對象AID']]??'').trim(),amount=numeric(row[idx['贈禮總金額']]),delta=numeric(row[idx['差額']]);
  if(!giver||!receiver||amount===null||amount<0){reject('invalid_directed_pair_amount_or_id');continue;}
  const key=giver+'>'+receiver;if(pairs.has(key)){record.validation.duplicatePairs++;const old=pairs.get(key);if(old.amount!==amount||(old.delta!==null&&delta!==null&&old.delta!==delta))reject('conflicting_duplicate_pair');continue;}pairs.set(key,{giver,receiver,amount,delta});
 }
 for(const pair of pairs.values()){
  const reverse=pairs.get(pair.receiver+'>'+pair.giver),expected=pair.amount-(reverse?.amount??0);
  if(pair.delta!==null){record.validation.netChecks.checked++;if(Math.abs(expected-pair.delta)<.01)record.validation.netChecks.matched++;else{record.validation.netChecks.mismatched++;reject('directed_give_net_mismatch');}}
  if(merchants.has(pair.giver)&&merchants.has(pair.receiver)){record.validation.excludedMerchantPairs++;continue;}
  if(merchants.has(pair.giver))buy+=pair.amount;else if(merchants.has(pair.receiver))sell+=pair.amount;else record.validation.excludedOrdinaryPairs++;
 }
 record.validation.uniqueDirectedPairs=pairs.size;
 if(record.validation.reasons.length)return record;
 return{...record,buyCoins:buy,sellCoins:sell,complete:true,covered:true,partial:through!==monthEnd(from.slice(0,7)),validation:{...record.validation,valid:true}};
}

// This keeps the exact query range. It deliberately has no per-day allocation:
// pair rankings contain period totals, not transaction completion timestamps.
export function parseMerchantParticipantSnapshot(snapshot,sourceFile){
 const coverage=parseMerchantPairSnapshot(snapshot,sourceFile);if(coverage.complete!==true)return{...coverage,participants:null};
 const merchants=new Set(coverage.merchantIDs),participants=new Map(),seen=new Set(),col=name=>snapshot.header.indexOf(name);
 for(const row of snapshot.rows){
  const giver=String(row[col('贈禮AID')]).trim(),receiver=String(row[col('對象AID')]).trim(),key=giver+'>'+receiver;if(seen.has(key))continue;seen.add(key);
  const from=merchants.has(giver),to=merchants.has(receiver);if(from===to)continue;const aid=from?receiver:giver,flow=participants.get(aid)??{received:0,returned:0};flow[from?'received':'returned']+=numeric(row[col('贈禮總金額')]);participants.set(aid,flow);
 }
 return{...coverage,participants};
}

export function mergeMerchantFundingWindows(pairWindows,fundingDaily,dailyByPlatform,policy,legacyCoverage=null){
 const legacyRows=new Map(fundingDaily.map(r=>[r.date,r])),completePairs=pairWindows.filter(w=>w.complete===true&&w.covered===true);
 function window(platform,from,through){
  if(platform==='win'&&legacyCoverage){const expected=dates(from,through);if(expected.length&&expected.every(d=>legacyRows.get(d)?.covered===true&&typeof legacyRows.get(d)?.buyCoins==='number'&&typeof legacyRows.get(d)?.sellCoins==='number'))return{platform,from,through,buyCoins:expected.reduce((s,d)=>s+legacyRows.get(d).buyCoins,0),sellCoins:expected.reduce((s,d)=>s+legacyRows.get(d).sellCoins,0),covered:true,kind:'validated_transactions',merchantIDs:[...CONFIRMED_MERCHANTS.win],source:'後台成功收贈禮完成日彙總；官儲為後台每日儲值同範圍加總',sourceUrl:legacyCoverage.sourceUrl,sourceFiles:legacyCoverage.sourceFiles.map(s=>typeof s==='string'?s:s.file),capturedAt:legacyCoverage.capturedAt};}
  return completePairs.filter(p=>p.platform===platform&&p.from===from&&p.through===through).sort((a,b)=>String(b.capturedAt).localeCompare(String(a.capturedAt)))[0]??null;
 }
 const periods=[...completePairs.map(p=>({platform:p.platform,from:p.from,through:p.through})),...fundingDaily.map(r=>r.date.slice(0,7)).filter((m,i,a)=>a.indexOf(m)===i).map(month=>({platform:'win',from:month+'-01',through:fundingDaily.filter(r=>r.date.startsWith(month)).at(-1).date}))],months=new Map();
 for(const p of periods){const key=p.platform+'|'+p.from.slice(0,7);if(!months.has(key))months.set(key,[]);if(!months.get(key).some(w=>w.from===p.from&&w.through===p.through))months.get(key).push(p);}
 const funding=[];
 for(const ranges of months.values()){
  // Prefer the latest exact range for which official daily cash is available.
  // This keeps the validated Win 19-day window when a 20-day pair snapshot has
  // arrived before the corresponding official daily report.
  const ordered=ranges.sort((a,b)=>b.through.localeCompare(a.through)),chosen=ordered.find(p=>cashInRange(dailyByPlatform[p.platform]??[],p.from,p.through)!==null)??ordered[0],current=window(chosen.platform,chosen.from,chosen.through);
  if(!current)continue;
  const {prevFrom,prevThrough}=previousPeriod(chosen.from,chosen.through),previous=window(chosen.platform,prevFrom,prevThrough),daily=dailyByPlatform[chosen.platform]??[];
  funding.push({...current,month:chosen.from.slice(0,7),from:chosen.from,through:chosen.through,to:chosen.through,prevFrom,prevThrough,partial:chosen.through!==monthEnd(chosen.from.slice(0,7)),directCash:cashInRange(daily,chosen.from,chosen.through),prevDirectCash:cashInRange(daily,prevFrom,prevThrough),prevBuyCoins:previous?.buyCoins??null,prevSellCoins:previous?.sellCoins??null,previousMerchantCovered:previous?.covered===true,previousSource:previous?.source??null,previousSourceFiles:previous?.sourceFiles??null,merchantIDs:[...CONFIRMED_MERCHANTS[chosen.platform]],...merchantConfirmation(chosen.platform)});
 }
 return addFundingConversion(funding.sort((a,b)=>MERCHANT_PLATFORM_ORDER.indexOf(a.platform)-MERCHANT_PLATFORM_ORDER.indexOf(b.platform)||a.month.localeCompare(b.month)),policy);
}

export async function buildMerchantFunding(live,dailyByPlatform,policy){
 const names=await fs.readdir(live),files=Object.values(MERCHANT_FILES).flat(),available=files.filter(f=>names.includes(f)),merchantCoverage=[];let fundingDaily=[];
 if(available.length&&available.length!==files.length)throw Error('既有Win完整交易來源缺頁，不可用月排行覆蓋缺漏');
 if(available.length){
  const snapshots={buy:[],sell:[]},sources=[];
  for(const [direction,files]of Object.entries(MERCHANT_FILES))for(const file of files){const raw=JSON.parse((await fs.readFile(path.join(live,file),'utf8')).replace(/^\uFEFF/,''));snapshots[direction].push(...parseMerchantSnapshot(raw,direction));sources.push({file,capturedAt:raw.capturedAt??null});}
  const sum=rows=>rows.reduce((s,r)=>s+r.coins,0);
  if(snapshots.buy.length!==1737||snapshots.sell.length!==321||Math.abs(sum(snapshots.buy)-4014950)>0.01||Math.abs(sum(snapshots.sell)-4730916)>0.01)throw Error('收贈禮筆數／金額未通過完整覆蓋驗證，停止換算彙總');
  const coverage={platform:'win',from:'2026-09-01',to:'2026-10-19',complete:true,merchantIDs:[...CONFIRMED_MERCHANTS.win],...merchantConfirmation('win'),successfulOnly:true,buyTransactions:snapshots.buy.length,sellTransactions:snapshots.sell.length,buyCoins:sum(snapshots.buy),sellCoins:sum(snapshots.sell),capturedAt:sources.map(s=>s.capturedAt).filter(Boolean).sort().at(-1)??null,sourceUrl:'https://admin.winmalo.com:9955/',sourceReport:'收贈禮統計成功交易',sourceFiles:sources,zeroMeaning:'只有此範圍內完整成功交易無紀錄的日期可視為0；其他日期或站點未知。'};
  merchantCoverage.push(coverage);fundingDaily=buildFundingDaily([...snapshots.buy,...snapshots.sell],coverage,dailyByPlatform.win??[],policy);
 }
 const pairs=[];
 for(const file of names.filter(f=>{const key=/^gift-rank-([a-z0-9]+)-.*\.json$/.exec(f)?.[1];return key&&CONFIRMED_MERCHANTS[key];}).sort()){
  const raw=JSON.parse((await fs.readFile(path.join(live,file),'utf8')).replace(/^\uFEFF/,'')),record=parseMerchantPairSnapshot(raw,file);pairs.push(record);merchantCoverage.push(record);
 }
 return{merchantCoverage,fundingDaily,funding:mergeMerchantFundingWindows(pairs,fundingDaily,dailyByPlatform,policy,merchantCoverage.find(c=>c.sourceReport==='收贈禮統計成功交易')??null)};
}
