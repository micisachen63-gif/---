import fs from 'node:fs/promises';import path from 'node:path';
import {MERCHANT_IDENTITY_REGISTRY} from './merchant-identities.mjs';
import {currentTaipeiDay,parseBackendNumber} from './backend-metrics.mjs';
const validDate=d=>typeof d==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(d)&&Number.isFinite(Date.parse(d))&&new Date(d).toISOString().slice(0,10)===d;
export function parseOwnedRegistrationSource(file,raw,{today=currentTaipeiDay()}={}){
 const m=/^owned-registration-period-(win|qz|song|rd|lucky|bo)-(\d{4}-\d{2}-\d{2})_(\d{4}-\d{2}-\d{2})\.json$/.exec(file),platform=m?.[1]??raw?.platform,from=raw?.period?.from,through=raw?.period?.to??raw?.period?.through,capturedAt=raw?.capturedAt??null,p=raw?.queryProof,issues=[];
 if(!m||raw?.platform!==platform||from!==m?.[2]||through!==m?.[3]||!validDate(from)||!validDate(through)||from>through)issues.push('registration_filename_or_period_mismatch');
 try{const u=new URL(raw.sourceUrl);if(u.protocol!=='https:'||u.host!==MERCHANT_IDENTITY_REGISTRY.platforms[platform]?.host||u.pathname.replace(/\/$/,'')!=='/statements/player-view'||u.username||u.password)issues.push('untrusted_registration_source');}catch{issues.push('untrusted_registration_source');}
 if(raw?.view!=='玩家總覽')issues.push('wrong_registration_view');
 if(raw?.complete===false)issues.push('registration_capture_incomplete');
 if(p?.verified!==true||p.selectedFrom!==from||p.selectedThrough!==through)issues.push('registration_selected_dates_not_verified');
 const captureDay=capturedAt&&Number.isFinite(Date.parse(capturedAt))?new Date(Date.parse(capturedAt)+8*3600000).toISOString().slice(0,10):null;
 if(!captureDay||through>=captureDay||captureDay>today||raw?.currentDayPartial===true)issues.push('registration_source_not_closed_at_capture');
 const count=parseBackendNumber(raw?.newRegistered);if(!Number.isSafeInteger(count)||count<0)issues.push('registration_count_invalid');
 return{file,platform,from,through,newRegistered:issues.length?null:count,capturedAt,sourceUrl:raw?.sourceUrl??null,view:raw?.view??null,queryProof:p??null,complete:issues.length===0,validation:{valid:issues.length===0,issues},definition:'玩家總覽指定註冊日期區間的新註冊人數；不採該註冊cohort截至擷取時累計儲值或贈禮。'};
}
export async function buildOwnedRegistrationPeriods(live,options={}){
 const docs=[];for(const file of (await fs.readdir(live)).filter(f=>/^owned-registration-period-(win|qz|song|rd|lucky|bo)-.*\.json$/.test(f)).sort())try{docs.push(parseOwnedRegistrationSource(file,JSON.parse((await fs.readFile(path.join(live,file),'utf8')).replace(/^\uFEFF/,'')),options));}catch{docs.push({file,platform:null,complete:false,newRegistered:null,validation:{valid:false,issues:['registration_json_unreadable']}});}
 const {buildRegistrationPeriods}=await import('./registration-period-data.mjs');
 return [...docs,...await buildRegistrationPeriods(live,options)];
}
