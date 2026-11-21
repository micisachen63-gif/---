'use strict';
/* Private Sheets adapter. No Google credential or sensitive player field goes to the browser. */
const crypto=require('node:crypto');
const SHEET_ID='1xsil-htvQ0TF6V9QB2FuGnHkhDLYR-NTFVyd8JPMLbQ';
const TAB='玩家登記與派獎';
let token=null,expires=0,lock=Promise.resolve();

function scriptConfig() {
  const web=process.env.GOOGLE_SCRIPT_WEBAPP_URL || '';
  const secret=process.env.GOOGLE_SCRIPT_SECRET || '';
  try {
    const url=new URL(web);
    if(url.protocol!=='https:' || url.hostname!=='script.google.com' ||
       !/^\/macros\/s\/[\w-]+\/exec$/.test(url.pathname) || secret.length<32) return null;
    return {url:url.toString(),secret};
  } catch {return null;}
}
async function scriptRequest(action,values={}) {
  const c=scriptConfig();
  if(!c)throw new Error('google_script_not_configured');
  const reply=await fetch(c.url,{
    method:'POST',redirect:'follow',headers:{'Content-Type':'text/plain;charset=utf-8'},
    body:JSON.stringify({action,...values,secret:c.secret}),
    signal:AbortSignal.timeout(19000)
  });
  if(!reply.ok)throw new Error('google_script_http_'+reply.status);
  const obj=await reply.json();
  if(!obj || typeof obj!=='object')throw new Error('google_script_invalid_json');
  return obj;
}
async function scriptRegister(valid) {
  // "valid" has already been checked with consent by register(); revalidating
  // here would accidentally reject every real registration (consent omitted).
  if(!valid||!valid.aid||!valid.name)return {status:400,result:{ok:false,error:'invalid_registration'}};
  const res=await scriptRequest('register',{aid:valid.aid,name:valid.name,consent:true});
  if(res.ok && res.status==='pending_review' && res.registeredAt)
    return {status:201,result:{ok:true,status:'pending_review',registeredAt:res.registeredAt}};
  if(res.error==='aid_already_registered')return {status:409,result:{ok:false,error:'aid_already_registered'}};
  if(res.error==='invalid_registration')return {status:400,result:{ok:false,error:'invalid_registration'}};
  throw new Error('script_registration_failed');
}

function checkedEventState(obj){
  const v=obj&&obj.event;
  if(!obj||obj.ok!==true||!v||!['CCB','READY','SCHEDULED','OFFICIAL','ENDED'].includes(v.phase)||
     !Number.isSafeInteger(v.epoch)||v.epoch<1||
     typeof v.startTW!=='string'|| !Number.isSafeInteger(v.registeredCount)||
     v.registeredCount<0)throw new Error('event_state_unsupported_or_invalid');
  const pattern=/^\d{4}\/\d\d\/\d\d \d\d:\d\d:\d\d$/;
  if(['SCHEDULED','OFFICIAL','ENDED'].includes(v.phase) &&
     (!pattern.test(v.startTW)||!pattern.test(v.endTW||'')))
    throw new Error('invalid_official_event_times');
  return {schemaVersion:Number.isSafeInteger(v.schemaVersion)?v.schemaVersion:0,
          phase:v.phase,epoch:v.epoch,startTW:v.startTW,endTW:v.endTW||'',
          registeredCount:v.registeredCount,resetComplete:v.resetComplete===true};
}
async function eventStatus(){
  if(!scriptConfig())throw new Error('event_status_requires_script');
  return checkedEventState(await scriptRequest('eventStatus'));
}
const CCB_RESET_REQUIRED_TABS=[
  '玩家登記與派獎','玩家公開榜單','機台原始紀錄','同步紀錄','雙神活動公開快照',
  '後勤_累積投注榜','後勤_單把倍率榜','後勤_個人成就榜','後勤_派獎總表'
];
async function clearCcb(){
  if(!scriptConfig())throw new Error('event_clear_requires_script');
  // Fail BEFORE deleting any row when the web-app deployment is still v3.
  const current=await eventStatus();
  if(current.schemaVersion<4)throw new Error('ccb_full_reset_requires_script_v4');
  if(!['CCB','READY'].includes(current.phase))
    throw new Error('official_data_protected');
  const result=await scriptRequest('clearCcb',{confirm:'清空CCB資料'});
  if(!result.ok)throw new Error('ccb_clear_failed_'+String(result.error||'unknown').slice(0,40));
  const state=checkedEventState(result);
  if(state.phase!=='READY'||state.registeredCount!==0||state.resetComplete!==true)
    throw new Error('ccb_reset_not_confirmed');
  const tabs=result.clearedTabs;
  if(!tabs||typeof tabs!=='object'||
     CCB_RESET_REQUIRED_TABS.some(name=>!Number.isSafeInteger(tabs[name])||tabs[name]<0))
    throw new Error('ccb_full_reset_verification_failed');
  return {event:state,cleared:result.cleared,clearedTabs:tabs};
}
async function startOfficial(startTW,endTW){
  if(!scriptConfig())throw new Error('event_start_requires_script');
  const current=await eventStatus();
  if(current.schemaVersion<4||current.resetComplete!==true)
    throw new Error('ccb_full_reset_required_before_official');
  if(current.phase!=='READY'||current.registeredCount!==0)
    throw new Error('must_clear_ccb_first');
  const result=await scriptRequest('startOfficial',{confirm:'啟動正式活動',startTW,endTW});
  if(!result.ok)throw new Error('official_start_failed_'+String(result.error||'unknown').slice(0,40));
  const state=checkedEventState(result);
  if(!['SCHEDULED','OFFICIAL'].includes(state.phase)||state.registeredCount!==0||state.startTW!==startTW||state.endTW!==endTW)throw new Error('official_start_not_confirmed');
  return {event:state};
}



async function persistPublicSnapshot(snapshot,awardLedger=null){
  if(!scriptConfig())throw new Error('public_archive_requires_script');
  const input={snapshot};
  if(awardLedger)input.awardLedger=awardLedger;
  const result=await scriptRequest('persistSnapshot',input);
  if(!result.ok || result.epoch!==snapshot.eventEpoch ||
     result.lastUpdated!==snapshot.lastUpdated ||
     (awardLedger && (result.ledgerUpdated!==true ||
                       result.ledgerUpdatedAt!==snapshot.lastUpdated)))
    throw new Error('public_snapshot_or_award_ledger_not_archived');
  return {ok:true,ledgerUpdated:Boolean(result.ledgerUpdated)};
}
async function readPublicSnapshot(){
  if(!scriptConfig())throw new Error('public_archive_requires_script');
  const result=await scriptRequest('getSnapshot');
  if(!result.ok || !Object.prototype.hasOwnProperty.call(result,'snapshot'))
    throw new Error('public_archive_not_available');
  return result.snapshot;
}

async function listAidsWithEvent(){
  if(!scriptConfig())throw new Error('aids_with_event_requires_script');
  const result=await scriptRequest('aids');
  if(!result.ok || result.eventCode!=='DUAL2026' || !Array.isArray(result.aids))
    throw new Error('script_aid_list_invalid');
  return {aids:validateAids(result.aids),event:checkedEventState(result)};
}
async function listAids() {
  if(scriptConfig()) {
    const result=await scriptRequest('aids');
    if(!result.ok || result.eventCode!=='DUAL2026'||!Array.isArray(result.aids))
      throw new Error('script_aid_list_invalid');
    const aids=validateAids(result.aids);
    return aids;
  }
  if(!credentials())throw new Error('sheet_access_unconfigured');
  const result=await sheetRequest('GET',"'"+TAB+"'!B2:E3000");
  return validateAids((result.values||[]).filter(row=>row[2]==='DUAL2026'&&row[3]!=='已取消').map(row=>String(row[0]||'')));
}
function validateAids(values) {
  if(values.length>3000)throw new Error('aid_list_too_large');
  const seen=new Set();
  for(const aid of values){
    if(typeof aid!=='string'|| !/^\d{6,20}$/.test(aid))throw new Error('bad_registered_aid');
    seen.add(aid);
  }
  return [...seen];
}

function credentials(){
  if(!process.env.GOOGLE_SERVICE_ACCOUNT_JSON)return null;
  try{
    const c=JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_JSON);
    if(!c.client_email||!c.private_key||!c.token_uri||!/^https:\/\/oauth2\.googleapis\.com\/token$/.test(c.token_uri))return null;
    return c;
  }catch{return null;}
}
function b64(v){return Buffer.from(typeof v==='string'?v:JSON.stringify(v)).toString('base64url');}
async function accessToken(){
  if(token&&Date.now()<expires-60000)return token;
  const c=credentials();if(!c)throw new Error('sheets_not_configured');
  const now=Math.floor(Date.now()/1000);
  const payload=b64({iss:c.client_email,scope:'https://www.googleapis.com/auth/spreadsheets',aud:c.token_uri,iat:now,exp:now+3600});
  const header=b64({alg:'RS256',typ:'JWT'}),unsigned=header+'.'+payload;
  const signature=crypto.sign('RSA-SHA256',Buffer.from(unsigned),c.private_key).toString('base64url');
  const response=await fetch(c.token_uri,{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({grant_type:'urn:ietf:params:oauth:grant-type:jwt-bearer',assertion:unsigned+'.'+signature}),signal:AbortSignal.timeout(12000)});
  if(!response.ok)throw new Error('google_oauth_rejected');
  const data=await response.json();
  if(!data.access_token)throw new Error('google_oauth_invalid');
  token=data.access_token;expires=Date.now()+Math.min(3500,Number(data.expires_in||3600))*1000;return token;
}
async function sheetRequest(method,range,body,query=''){
  const url='https://sheets.googleapis.com/v4/spreadsheets/'+SHEET_ID+'/values/'+encodeURIComponent(range)+query;
  const response=await fetch(url,{method,headers:{Authorization:'Bearer '+await accessToken(),'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(14000)});
  if(!response.ok)throw new Error('sheets_http_'+response.status);
  return response.json();
}
let lastAccess={at:0,ok:false};
async function checkAccess(){
  if(!credentials() && !scriptConfig())return false;
  if(Date.now()-lastAccess.at<30000)return lastAccess.ok;
  try{
    if(scriptConfig()){
      const status=await scriptRequest('status');
      const ok=status.ok===true && status.enabled===true && status.spreadsheetId===SHEET_ID;
      lastAccess={at:Date.now(),ok};
      return ok;
    }
    const response=await sheetRequest('GET',"'"+TAB+"'!A1:J1");
    const headers=response.values&&response.values[0];
    const ok=!!headers&&headers[0]==='登記時間'&&headers[1]==='AID'&&headers[2]==='真實姓名（僅管理員）'&&headers[3]==='活動代碼';
    lastAccess={at:Date.now(),ok};return ok;
  }catch{return false;}
}
function validateRegistration(body){
  if(!body||typeof body!=='object')return null;
  const aid=String(body.aid||'').trim(),name=String(body.name||'').trim().normalize('NFC');
  if(!/^\d{6,20}$/.test(aid)||name.length<2||name.length>40||/[\x00-\x1f\x7f<>]/.test(name)||/^[=+\-@]/.test(name)||body.consent!==true)return null;
  if(Object.keys(body).some(k=>!['aid','name','consent'].includes(k)))return null;
  return {aid,name};
}
async function register(payload){
  const valid=validateRegistration(payload);
  if(!valid)return {status:400,result:{ok:false,error:'invalid_registration'}};
  if(!await checkAccess())return {status:503,result:{ok:false,error:'registration_unavailable'}};
  if(scriptConfig())return scriptRegister(valid);
  const work=async()=>{
    const existing=await sheetRequest('GET',"'"+TAB+"'!B2:B3000");
    if((existing.values||[]).some(row=>String(row[0]||'').trim()===valid.aid))
      return {status:409,result:{ok:false,error:'aid_already_registered'}};
    const when=new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Taipei',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'}).format(new Date());
    const row=[when,valid.aid,valid.name,'DUAL2026','已登記','AID已驗證','待確認','未派獎','',new Date().toISOString()];
    const added=await sheetRequest('POST',"'"+TAB+"'!A:J",{majorDimension:'ROWS',values:[row]},'?valueInputOption=RAW&insertDataOption=INSERT_ROWS');
    const location=added.updates&&added.updates.updatedRange;
    if(!location||!location.includes(TAB))throw new Error('sheets_append_unverified');
    const verified=await sheetRequest('GET',location);
    if(!verified.values||String(verified.values[0]?.[1])!==valid.aid)throw new Error('sheets_readback_mismatch');
    return {status:201,result:{ok:true,status:'pending_review',registeredAt:when}};
  };
  const next=lock.then(work,work);lock=next.catch(()=>{});return next;
}
module.exports={credentials,scriptConfig,checkAccess,validateRegistration,register,listAids,listAidsWithEvent,validateAids,checkedEventState,eventStatus,clearCcb,startOfficial,persistPublicSnapshot,readPublicSnapshot,SHEET_ID,TAB};
