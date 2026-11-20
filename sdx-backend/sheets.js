'use strict';
/* Private Sheets adapter. No Google credential or sensitive player field goes to the browser. */
const crypto=require('node:crypto');
const SHEET_ID='1xsil-htvQ0TF6V9QB2FuGnHkhDLYR-NTFVyd8JPMLbQ';
const TAB='玩家登記與派獎';
let token=null,expires=0,lock=Promise.resolve();
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
  if(!credentials())return false;
  if(Date.now()-lastAccess.at<30000)return lastAccess.ok;
  try{
    const response=await sheetRequest('GET',"'"+TAB+"'!A1:J1");
    const headers=response.values&&response.values[0];
    const ok=!!headers&&headers[0]==='登記時間'&&headers[1]==='AID'&&headers[2]==='真實姓名（僅管理員）'&&headers[3]==='活動代碼';
    lastAccess={at:Date.now(),ok};return ok;
  }catch{return false;}
}
function validateRegistration(body){
  if(!body||typeof body!=='object')return null;
  const aid=String(body.aid||'').trim(),name=String(body.name||'').trim().normalize('NFC');
  if(!/^\d{6,20}$/.test(aid)||name.length<2||name.length>40||/[\x00-\x1f\x7f<>]/.test(name)||!body.consent)return null;
  if(Object.keys(body).some(k=>!['aid','name','consent'].includes(k)))return null;
  return {aid,name};
}
async function register(payload){
  const valid=validateRegistration(payload);
  if(!valid)return {status:400,result:{ok:false,error:'invalid_registration'}};
  if(!await checkAccess())return {status:503,result:{ok:false,error:'registration_unavailable'}};
  const work=async()=>{
    const existing=await sheetRequest('GET',"'"+TAB+"'!B2:B3000");
    if((existing.values||[]).some(row=>String(row[0]||'').trim()===valid.aid))
      return {status:409,result:{ok:false,error:'aid_already_registered'}};
    const when=new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Taipei',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'}).format(new Date());
    const row=[when,valid.aid,valid.name,'DUAL2026','待審核','未核對','待確認','未派獎','',new Date().toISOString()];
    const added=await sheetRequest('POST',"'"+TAB+"'!A:J",{majorDimension:'ROWS',values:[row]},'?valueInputOption=RAW&insertDataOption=INSERT_ROWS');
    const location=added.updates&&added.updates.updatedRange;
    if(!location||!location.includes(TAB))throw new Error('sheets_append_unverified');
    const verified=await sheetRequest('GET',location);
    if(!verified.values||String(verified.values[0]?.[1])!==valid.aid)throw new Error('sheets_readback_mismatch');
    return {status:201,result:{ok:true,status:'pending_review',registeredAt:when}};
  };
  const next=lock.then(work,work);lock=next.catch(()=>{});return next;
}
module.exports={credentials,checkAccess,validateRegistration,register,SHEET_ID,TAB};
