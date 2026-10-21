import fs from 'node:fs/promises';
import path from 'node:path';
import {DETAIL_PLATFORM_HOSTS} from './detail-source-selection.mjs';
import {currentTaipeiDay,parseBackendNumber} from './backend-metrics.mjs';
const day=d=>typeof d==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(d)&&Number.isFinite(Date.parse(d))&&new Date(d).toISOString().slice(0,10)===d;
// Earlier read-only competitor captures used the owned-registration prefix.
// Accept that historical filename only for the six known competitors; the
// actual host, selected period, freshness and device totals remain mandatory.
const registrationFilename=file=>/^registration-period-([a-z0-9]+)-(\d{4}-\d{2}-\d{2})_(\d{4}-\d{2}-\d{2})\.json$/.exec(file)??/^owned-registration-period-(o8|aos|fcc|cgb|goldfun|o9)-(\d{4}-\d{2}-\d{2})_(\d{4}-\d{2}-\d{2})\.json$/.exec(file);
export function parseRegistrationPeriodSource(file,raw,{today=currentTaipeiDay()}={}){
 const match=registrationFilename(file),platform=raw?.platform,from=raw?.period?.from??raw?.from,through=raw?.period?.to??raw?.period?.through??raw?.through,q=raw?.queryProof,capturedAt=raw?.capturedAt??null,issues=[];
 if(!match||!Object.hasOwn(DETAIL_PLATFORM_HOSTS,platform??'')||platform!==match?.[1]||from!==match?.[2]||through!==match?.[3]||!day(from)||!day(through)||from>through)issues.push('registration_filename_or_period_mismatch');
 try{const u=new URL(raw.sourceUrl);if(u.protocol!=='https:'||u.host!==DETAIL_PLATFORM_HOSTS[platform]||u.pathname.replace(/\/$/,'')!=='/statements/player-view'||u.username||u.password)issues.push('untrusted_registration_source');}catch{issues.push('untrusted_registration_source');}
 if(raw?.view!=='玩家總覽')issues.push('wrong_registration_view');
 if(raw?.complete!==true)issues.push('registration_capture_incomplete');
 if(q?.verified!==true||q.selectedFrom!==from||q.selectedThrough!==through)issues.push('registration_selected_dates_not_verified');
 const captureDay=typeof capturedAt==='string'&&Number.isFinite(Date.parse(capturedAt))?new Date(Date.parse(capturedAt)+8*3600000).toISOString().slice(0,10):null;
 if(!captureDay||through>=captureDay||captureDay>today||raw?.currentDayPartial===true)issues.push('registration_source_not_closed_at_capture');
 const count=parseBackendNumber(raw?.newRegistered);if(!Number.isSafeInteger(count)||count<0)issues.push('registration_count_invalid');
 if(raw?.registrationTable!==undefined){const table=raw.registrationTable,devices=new Map();let valid=Array.isArray(table)&&table[0]?.[0]===''&&table[0]?.[1]==='創建帳號'&&table[1]?.[0]==='平台'&&table[1]?.[1]==='數量';for(const row of Array.isArray(table)?table.slice(2):[]){const value=parseBackendNumber(row?.[1]),label=row?.[0];if(!['Android','Apple','Web','Unknown','All'].includes(label)||devices.has(label)||!Number.isSafeInteger(value)||value<0)valid=false;else devices.set(label,value);}if(!['Android','Apple','Web','All'].every(label=>devices.has(label))||devices.get('All')!==count||['Android','Apple','Web','Unknown'].reduce((n,label)=>n+(devices.get(label)??0),0)!==count)valid=false;if(!valid)issues.push('registration_device_total_mismatch');}
 return{file,platform,from,through,newRegistered:issues.length?null:count,capturedAt,sourceUrl:raw?.sourceUrl??null,view:raw?.view??null,queryProof:q?{verified:q.verified,selectedFrom:q.selectedFrom,selectedThrough:q.selectedThrough,freshResultVerified:q.freshResultVerified}:null,complete:!issues.length,validation:{valid:!issues.length,issues},definition:'玩家總覽指定創建帳號日期區間的真新註冊總數；不以該cohort終身儲值、末次登入或付費人數替代。'};
}
export async function buildRegistrationPeriods(live,options={}){let files;try{files=await fs.readdir(live);}catch(error){if(error.code==='ENOENT')return[];throw error;}const docs=[];for(const file of files.filter(file=>/^registration-period-.*\.json$/.test(file)||/^owned-registration-period-(o8|aos|fcc|cgb|goldfun|o9)-.*\.json$/.test(file)).sort())try{docs.push(parseRegistrationPeriodSource(file,JSON.parse((await fs.readFile(path.join(live,file),'utf8')).replace(/^\uFEFF/,'')),options));}catch{docs.push({file,platform:null,complete:false,newRegistered:null,validation:{valid:false,issues:['registration_json_unreadable']}});}return docs;}
