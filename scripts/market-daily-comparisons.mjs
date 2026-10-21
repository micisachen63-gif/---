import fs from 'node:fs/promises';import path from 'node:path';
import {normalizeDaily,splitTodayProgress,currentTaipeiDay} from './backend-metrics.mjs';
import {parseCompetitorCashSource} from './competitor-funding.mjs';
const valid=v=>typeof v==='number'&&Number.isFinite(v)&&v>=0;
const hosts={o8:'admin.8o8.tw:9955',aos:'admin.aos888.com:9955',fcc:'admin.fcc99.com:9955',cgb:'admin.cgb777.com:9955',goldfun:'admin.goldfun88.com:9955',o9:'admin.o9play.com:9955'};
function dates(from,through){const out=[];for(let t=Date.parse(from);t<=Date.parse(through);t+=86400000)out.push(new Date(t).toISOString().slice(0,10));return out;}
function summary(sources,p,today){
 const map=new Map(),rejectedSources=[];
 for(const source of sources){if(source.validation?.valid===false){rejectedSources.push({file:source.file??null,issues:source.validation.issues??[]});continue;}
  if(source.capturedAt&&Number.isFinite(Date.parse(source.capturedAt))&&new Date(Date.parse(source.capturedAt)+8*3600000).toISOString().slice(0,10)>today){rejectedSources.push({file:source.file??null,issues:['capture_after_analysis_day']});continue;}
  let closed;try{closed=source.alreadyValidatedClosed?source.rows:splitTodayProgress(source.rows??[],source,today).daily;}catch{rejectedSources.push({file:source.file??null,issues:['duplicate_daily_dates']});continue;}
  for(const row of closed){if(row[0]<p.from||row[0]>p.through)continue;const prior=map.get(row[0]);if(!prior||Date.parse(source.capturedAt)>Date.parse(prior.source.capturedAt))map.set(row[0],{row,source});}
 }
 const expected=dates(p.from,p.through),missingDates=expected.filter(d=>!map.has(d)),missing=index=>expected.filter(d=>!valid(map.get(d)?.row[index])),cashMissingDates=missing(4),dauMissingDates=missing(1),dpuMissingDates=missing(2),cashComplete=expected.length>0&&!cashMissingDates.length,dauComplete=expected.length>0&&!dauMissingDates.length,dpuComplete=expected.length>0&&!dpuMissingDates.length,used=[...new Set([...map.values()].map(x=>x.source))];
 const total=index=>expected.reduce((s,d)=>s+map.get(d).row[index],0),metadata=used.map(s=>({file:s.file??null,from:s.from??null,through:s.through??null,capturedAt:s.capturedAt??null,sourceUrl:s.sourceUrl??null,queryProof:s.queryProof??null}));
 return{...p,cash:cashComplete?total(4):null,dau:dauComplete?total(1)/expected.length:null,dpu:dpuComplete?total(2)/expected.length:null,days:map.size,expectedDays:expected.length,complete:!missingDates.length&&expected.length>0,cashComplete,dauComplete,dpuComplete,missingDates,cashMissingDates,dauMissingDates,dpuMissingDates,sourceFiles:[...new Set(metadata.map(s=>s.file).filter(Boolean))],capturedAt:metadata.map(s=>s.capturedAt).filter(Boolean).sort((a,b)=>Date.parse(b)-Date.parse(a))[0]??null,sources:metadata,rejectedSources,definition:'DAU/DPU為指定日期完整日報的日均人次，不是區間去重MAU/MPU；官儲與活躍數值各自驗證缺欄。'};
}
export function analyzeMarketDailyComparisons(sourcesByPlatform,period,{today=currentTaipeiDay()}={}){
 return{schema:1,period,rows:Object.entries(sourcesByPlatform).map(([platform,sources])=>({platform,current:summary(sources,{from:period.currentFrom,through:period.currentThrough},today),previous:summary(sources,{from:period.previousFrom,through:period.previousThrough},today)}))};
}
export async function buildMarketDailyComparisons(live,{daily={},platforms=[],ownedCashSources=[],competitors=[],period,today=currentTaipeiDay()}={}){
 if(!period)throw Error('Explicit market comparison period required');const by={};
 for(const p of platforms){const sources=ownedCashSources.filter(s=>s.platform===p.key&&s.complete),latest=[...sources].sort((a,b)=>Date.parse(b.capturedAt)-Date.parse(a.capturedAt))[0];by[p.key]=[{rows:daily[p.key]??[],alreadyValidatedClosed:true,capturedAt:latest?.capturedAt??p.dailyCapturedAt??p.sourceRun,sourceUrl:latest?.sourceUrl??p.url+'statements/player-summary',file:latest?.file??'validated-owned-daily',from:latest?.from,through:latest?.through,queryProof:latest?.queryProof}];}
 for(const key of Object.keys(hosts)){const c=competitors.find(s=>s.key===key),source=c?.consumeDaily;by[key]=source?[{rows:normalizeDaily(source),capturedAt:source.capturedAt??c.capturedAt,sourceUrl:source.sourceUrl??c.url+'statements/player-summary',file:'competitor-observations.json#'+key}]:[];}
 for(const file of (await fs.readdir(live)).filter(f=>/^competitor-cash-range-(o8|aos|fcc|cgb|goldfun|o9)-.*\.json$/.test(f)).sort()){
  const platform=/^competitor-cash-range-([^-]+)-/.exec(file)[1];try{const raw=JSON.parse((await fs.readFile(path.join(live,file),'utf8')).replace(/^\uFEFF/,'')),s=parseCompetitorCashSource(file,raw);let trusted=false;try{const u=new URL(s.sourceUrl);trusted=u.protocol==='https:'&&u.host===hosts[platform]&&u.pathname.replace(/\/$/,'')==='/statements/player-summary'&&!u.username&&!u.password;}catch{}if(!trusted)s.validation={valid:false,issues:['untrusted_cash_source']};by[platform].push(s);}catch{by[platform].push({file,validation:{valid:false,issues:['cash_source_unreadable']}});}
 }
 return analyzeMarketDailyComparisons(by,period,{today});
}
