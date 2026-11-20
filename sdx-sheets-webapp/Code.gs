/**
 * SD × 贏麻了 2026 活動：Google Sheets 登記與已登記 AID 閘道。
 *
 * 此 Script 必須由有「活動專用後台」編輯權限的 Google 帳號部署成
 * Web app (Execute as: Me; Who has access: Anyone)。
 * Web app URL 只設定在 Render 環境變數，不要寫入活動網頁。
 * 設定 / Project Settings / Script Properties：
 *   SDX_REGISTRATION_SECRET = 與 Render 的 GOOGLE_SCRIPT_SECRET 相同（至少 32 字元）
 *
 * 此工具僅回傳 AID 給持有伺服器密鑰的 Render 後端，不提供公開列表。
 */
const SDX_SPREADSHEET_ID='1xsil-htvQ0TF6V9QB2FuGnHkhDLYR-NTFVyd8JPMLbQ';
const SDX_TAB='玩家登記與派獎';
const SDX_EVENT='DUAL2026';
const SDX_HEADERS=['登記時間','AID','真實姓名（僅管理員）','活動代碼','登記狀態','核對狀態','派獎資格','派獎狀態','派獎備註','最後更新'];

function respond_(value) {
  return ContentService.createTextOutput(JSON.stringify(value)).setMimeType(ContentService.MimeType.JSON);
}
function sheet_() {
  const sh=SpreadsheetApp.openById(SDX_SPREADSHEET_ID).getSheetByName(SDX_TAB);
  if(!sh)throw new Error('sheet_missing');
  const headers=sh.getRange(1,1,1,SDX_HEADERS.length).getDisplayValues()[0];
  if(!SDX_HEADERS.every((name,i)=>headers[i]===name))throw new Error('sheet_headers_changed');
  return sh;
}
function aids_(sh) {
  const last=sh.getLastRow();
  if(last<2)return [];
  const values=sh.getRange(2,2,last-1,4).getDisplayValues();
  const seen={},aids=[];
  values.forEach(row=>{
    const aid=String(row[0]||'').trim(),code=String(row[2]||'').trim(),status=String(row[3]||'').trim();
    if(code!==SDX_EVENT || !/^\d{6,20}$/.test(aid) || status==='已取消' || seen[aid])return;
    seen[aid]=true;
    aids.push(aid);
  });
  return aids;
}
function register_(sh, input) {
  const aid=String(input.aid||'').trim();
  const name=String(input.name||'').trim().normalize('NFC');
  if(!/^\d{6,20}$/.test(aid) || name.length<2 || name.length>40 ||
     /[\x00-\x1f\x7f<>]/.test(name) || /^[=+\-@]/.test(name) || input.consent!==true)
    return {ok:false,error:'invalid_registration'};
  const lock=LockService.getScriptLock();
  if(!lock.tryLock(18000))return {ok:false,error:'registration_busy'};
  try{
    const all=aids_(sh);
    if(all.includes(aid))return {ok:false,error:'aid_already_registered'};
    const when=Utilities.formatDate(new Date(),'Asia/Taipei','yyyy-MM-dd HH:mm:ss');
    const row=[when,aid,name,SDX_EVENT,'已登記','AID已驗證','待確認','未派獎','',new Date().toISOString()];
    const nextRow=sh.getLastRow()+1;
    // AID must be text; never let Sheets round long numeric identifiers.
    sh.getRange(nextRow,2).setNumberFormat('@');
    sh.getRange(nextRow,1,1,10).setValues([row]);
    SpreadsheetApp.flush();
    const actual=sh.getRange(sh.getLastRow(),1,1,10).getDisplayValues()[0];
    if(actual[1]!==aid || actual[3]!==SDX_EVENT || actual[2]!==name)
      throw new Error('sheet_readback_mismatch');
    return {ok:true,status:'pending_review',registeredAt:when};
  }finally{lock.releaseLock();}
}
function doPost(e) {
  try{
    if(!e || !e.postData || typeof e.postData.contents!=='string')
      return respond_({ok:false,error:'invalid_payload'});
    if(e.postData.contents.length>4096)return respond_({ok:false,error:'payload_too_large'});
    const input=JSON.parse(e.postData.contents);
    const secret=PropertiesService.getScriptProperties().getProperty('SDX_REGISTRATION_SECRET')||'';
    if(secret.length<32 || typeof input.secret!=='string' || input.secret!==secret)
      return respond_({ok:false,error:'unauthorized'});
    const sh=sheet_();
    if(input.action==='status')return respond_({ok:true,enabled:true,spreadsheetId:SDX_SPREADSHEET_ID});
    if(input.action==='aids')return respond_({ok:true,enabled:true,aids:aids_(sh),eventCode:SDX_EVENT});
    if(input.action==='register')return respond_(register_(sh,input));
    return respond_({ok:false,error:'invalid_action'});
  }catch(err){
    // Never return AIDs, names, credentials or raw record contents.
    const known=['sheet_missing','sheet_headers_changed','sheet_readback_mismatch','registration_busy','invalid_registration','aid_already_registered'];
    const code=known.includes(String(err.message))?String(err.message):'backend_error';
    return respond_({ok:false,error:code});
  }
}
function doGet() {return respond_({ok:false,error:'post_required'});}
