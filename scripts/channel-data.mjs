import fs from 'node:fs/promises';
import path from 'node:path';

const DEFAULT_PERIODS=[
 {month:'2026-09',cutoff:'2026-09-19',members:'members-2026-09-01_2026-09-30-asof-20261020.json',deposits:'deposit-ranking-2026-09-01_2026-09-19.json'},
 {month:'2026-10',cutoff:'2026-10-19',members:'members-2026-10-01_2026-10-20.json',deposits:'deposit-ranking-2026-10-01_2026-10-19.json'}
];
const number=value=>{
 if(value==null||String(value).trim()==='')return null;
 if(String(value).trim()==='-')return 0;
 const n=Number(String(value).replaceAll(',',''));return Number.isFinite(n)?n:null;
};
export function sourceChannel(value){return value==null||['','-','—'].includes(String(value).trim())?'未標記':String(value);}
const median=values=>{if(!values.length)return null;const a=[...values].sort((x,y)=>x-y),i=Math.floor(a.length/2);return a.length%2?a[i]:(a[i-1]+a[i])/2;};
export function channelMetrics(players){
 const payers=players.filter(p=>p.firstperiodCash>0);
 return {registrations:players.length,bound:players.filter(p=>p.bound===true).length,bindingUnknown:players.filter(p=>p.bound===null).length,initialUntouched:players.filter(p=>p.initialUntouched).length,firstPayers:payers.length,firstPaidCash:payers.reduce((s,p)=>s+p.firstperiodCash,0),conversionRate:players.length?payers.length/players.length:null,medianFirstPeriodCash:median(payers.map(p=>p.firstperiodCash))};
}
function depositMap(snapshot){
 const map=new Map();
 for(const row of snapshot.rows.slice(1)){const aid=String(row[1]??'').trim();if(!aid)continue;if(map.has(aid))throw Error('儲值排行 AID 重複，不能直接累加：'+aid);const cash=number(row[6]);if(cash===null||cash<0)throw Error('儲值排行金額無效：'+aid);map.set(aid,{cash,name:String(row[3]??'')});}
 return map;
}
export function buildChannelData(snapshots){
 const players=[],periods=[];
 for(const {month,cutoff,members,deposits,memberFile=null,depositFile=null} of snapshots){
  if(!/^\d{4}-\d{2}$/.test(month)||!/^\d{4}-\d{2}-\d{2}$/.test(cutoff)||!cutoff.startsWith(month))throw Error('渠道分析期間無效');
  if(deposits.period?.[0]!==month+'-01'||deposits.period?.[1]!==cutoff)throw Error('儲值排行期間與比較截止日不符');
  const cash=depositMap(deposits),seen=new Set(),list=[];
  for(const row of members.rows.slice(1)){
   const aid=String(row[0]??'').trim(),created=String(row[10]??'');
   if(!aid||!created.startsWith(month)||created.slice(0,10)>cutoff)continue;
   if(seen.has(aid))throw Error('註冊名單 AID 重複：'+aid);seen.add(aid);
   const totalCash=number(row[3]),coin=number(row[5]),wash=number(row[6]);
   const player={platform:'win',month,cutoff,aid,name:String(row[1]??cash.get(aid)?.name??''),channel:sourceChannel(row[8]),created,firstperiodCash:cash.get(aid)?.cash??0,bound:row[9]==='已綁定'?true:row[9]==='未綁定'?false:null,initialUntouched:totalCash===0&&coin===20&&wash===500,membersCapturedAt:members.capturedAt??null,depositsCapturedAt:deposits.capturedAt??null};
   list.push(player);players.push(player);
  }
  periods.push({month,cutoff,start:month+'-01',days:Number(cutoff.slice(8)),...channelMetrics(list),membersSource:{file:memberFile,period:members.period??null,capturedAt:members.capturedAt??null},depositsSource:{file:depositFile,period:deposits.period??null,capturedAt:deposits.capturedAt??null}});
 }
 const channels=[...new Set(players.map(p=>p.channel))].sort((a,b)=>a.localeCompare(b,'zh-Hant')).map(channel=>({channel,periods:periods.map(period=>({month:period.month,cutoff:period.cutoff,...channelMetrics(players.filter(p=>p.channel===channel&&p.month===period.month))}))}));
 return {platform:'win',cutoff:periods.at(-1)?.cutoff??null,scope:'fixed-asof',periods,channels,players,definitions:{source:'依後台來源完整字串分組；缺值、空白與橫線顯示未標記，不合併不同 google 來源。',firstPayer:'比較期間內註冊，且同期間儲值排行金額大於 0 的會員；現金為該期間直儲加總，不含幣商金幣。',conversionRate:'同期首付會員數 ÷ 同期新增註冊數；分母為 0 時為 null。',medianFirstPeriodCash:'同期首付會員在比較期間的直儲現金中位數；無付費會員時為 null。',initialUntouched:'後台會員快照中總儲值為 0、金幣為 20、洗碼限制為 500，標為疑似未啟動；不能認定是假帳號。',snapshotCaution:'已綁定與疑似未啟動為來源 capturedAt 當下的會員狀態，不是各月 19 日的歷史狀態；同期註冊與直儲只計各月 1–19 日。',privacy:'只輸出綁定狀態，不輸出電話、LineID 或其他聯絡資訊。'}};
}
export async function buildChannels(live){
 const read=async filename=>JSON.parse((await fs.readFile(path.join(live,filename),'utf8')).replace(/^\uFEFF/,''));
 const snapshots=await Promise.all(DEFAULT_PERIODS.map(async p=>({...p,members:await read(p.members),deposits:await read(p.deposits),memberFile:p.members,depositFile:p.deposits})));
 return buildChannelData(snapshots);
}
