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

/**
 * Persistent event state resides in ScriptProperties, not Render's temporary disk.
 * CCB (test) -> READY (cleared, no registration) -> OFFICIAL (new timestamp).
 * Each transition increments epoch, so old sync processes cannot republish CCB data.
 */
const SDX_STATE_PROP='SDX_DUAL2026_EVENT_STATE';
function taipeiDate_(text){
  if(typeof text!=='string'||!/^\d{4}\/\d{2}\/\d{2} \d{2}:\d{2}:\d{2}$/.test(text))
    throw new Error('invalid_event_dates');
  const d=Utilities.parseDate(text,'Asia/Taipei','yyyy/MM/dd HH:mm:ss');
  if(!d || isNaN(d.getTime())||
     Utilities.formatDate(d,'Asia/Taipei','yyyy/MM/dd HH:mm:ss')!==text)
    throw new Error('invalid_event_dates');
  return d;
}
function eventState_(){
  const raw=PropertiesService.getScriptProperties().getProperty(SDX_STATE_PROP);
  if(!raw)return {phase:'CCB',epoch:1,startTW:'',endTW:''};
  const state=JSON.parse(raw);
  if(!['CCB','READY','OFFICIAL'].includes(state.phase) ||
     !Number.isSafeInteger(state.epoch)||state.epoch<1||
     typeof state.startTW!=='string')throw new Error('invalid_event_state');
  const endTW=state.endTW||'';
  if(state.phase==='OFFICIAL'){
    const start=taipeiDate_(state.startTW),end=taipeiDate_(endTW);
    if(end.getTime()<=start.getTime())throw new Error('invalid_event_dates');
    const now=Date.now();
    return Object.assign({},state,{endTW,phase:
      now<start.getTime()?'SCHEDULED':now>=end.getTime()?'ENDED':'OFFICIAL'});
  }
  return Object.assign({},state,{endTW});
}
function setEventState_(state){
  PropertiesService.getScriptProperties().setProperty(SDX_STATE_PROP,JSON.stringify(state));
}
function eventSummary_(sh){
  const state=eventState_();
  return {phase:state.phase,epoch:state.epoch,startTW:state.startTW,
          endTW:state.endTW,registeredCount:aids_(sh).length};
}

function currentEventRows_(sh){
  const last=sh.getLastRow();
  if(last<2)return [];
  const codes=sh.getRange(2,4,last-1,1).getDisplayValues();
  const rows=[];
  codes.forEach((r,i)=>{if(String(r[0]||'').trim()===SDX_EVENT)rows.push(i+2)});
  return rows;
}
function clearCcb_(sh,body){
  if(body.confirm!=='清空CCB資料')return {ok:false,error:'confirmation_required'};
  const lock=LockService.getScriptLock();
  if(!lock.tryLock(20000))return {ok:false,error:'event_busy'};
  try{
    const old=eventState_();
    if(!['CCB','READY'].includes(old.phase))return {ok:false,error:'official_data_protected'};
    if(old.phase==='CCB')setEventState_({
      phase:'READY',epoch:old.epoch+1,startTW:'',clearedAt:new Date().toISOString()
    });
    // State is READY before deletion: registration is blocked even if this fails.
    const rows=currentEventRows_(sh);
    // Delete contiguous ranges from bottom to top. One deleteRows call per
    // contiguous group, rather than one network call per participant.
    let count=0;
    for(let i=rows.length-1;i>=0;){
      const end=rows[i];let start=end;i--;
      while(i>=0 && rows[i]===start-1){start=rows[i];i--}
      sh.deleteRows(start,end-start+1);
      count+=end-start+1;
    }
    SpreadsheetApp.flush();
    if(currentEventRows_(sh).length!==0)throw new Error('clear_readback_failed');
    return {ok:true,cleared:count,event:eventSummary_(sh)};
  } finally{lock.releaseLock();}
}
function startOfficial_(sh,body){
  if(body.confirm!=='啟動正式活動')return {ok:false,error:'confirmation_required'};
  const lock=LockService.getScriptLock();
  if(!lock.tryLock(20000))return {ok:false,error:'event_busy'};
  try{
    const old=eventState_();
    if(old.phase!=='READY')return {ok:false,error:'must_clear_ccb_first'};
    if(currentEventRows_(sh).length!==0)return {ok:false,error:'registrations_not_empty'};
    const start=taipeiDate_(body.startTW),end=taipeiDate_(body.endTW);
    const now=Date.now();
    if(start.getTime()<now-30000 || start.getTime()>now+365*86400000 ||
       end.getTime()<=start.getTime() || end.getTime()-start.getTime()>45*86400000)
      return {ok:false,error:'invalid_event_dates'};
    const next={phase:'OFFICIAL',epoch:old.epoch+1,startTW:body.startTW,
      endTW:body.endTW,officialConfiguredAt:new Date().toISOString()};
    setEventState_(next);
    return {ok:true,event:eventSummary_(sh)};
  }finally{lock.releaseLock();}
}


/* Durable public-only snapshot for an ENDED event. The Google Sheet stores a
 * sanitized B2B snapshot, never an AID, full name, session, wager receipt, or cookie.
 * A single row is overwritten during OFFICIAL; after the end instant it is immutable.
 * One Google Sheets cell may hold up to 50k chars, hence the 30k UTF-16 chunks. */
const SDX_ARCHIVE_TAB='雙神活動公開快照';
function archiveSheet_(create){
  const book=SpreadsheetApp.openById(SDX_SPREADSHEET_ID);
  let tab=book.getSheetByName(SDX_ARCHIVE_TAB);
  if(!tab && create){
    tab=book.insertSheet(SDX_ARCHIVE_TAB);
    tab.getRange(1,1,1,4).setValues([['活動世代','最後同步時間','JSON片段數','公開榜單JSON（D欄起分段）']]);
    tab.setFrozenRows(1);
  }
  return tab;
}
function persistSnapshot_(sh,body){
  const lock=LockService.getScriptLock();
  if(!lock.tryLock(20000))return {ok:false,error:'event_busy'};
  try{
    const state=eventState_(),snapshot=body.snapshot;
    if(state.phase!=='OFFICIAL')return {ok:false,error:'event_not_running'};
    if(!snapshot || typeof snapshot!=='object' || Array.isArray(snapshot) ||
       snapshot.ok!==true || snapshot.eventPhase!=='OFFICIAL' ||
       snapshot.eventEpoch!==state.epoch ||
       snapshot.eventStartTW!==state.startTW ||
       snapshot.eventEndTW!==state.endTW ||
       !snapshot.rankings || !snapshot.luckboard)
      return {ok:false,error:'archive_snapshot_invalid'};
    const obj=JSON.stringify(snapshot);
    if(obj.length>300000)return {ok:false,error:'archive_too_large'};
    const chunks=obj.match(/[\s\S]{1,30000}/g)||[];
    const archive=archiveSheet_(true);
    const previous=archive.getLastColumn();
    const row=[state.epoch,snapshot.lastUpdated,chunks.length,...chunks];
    archive.getRange(2,1,1,row.length).setValues([row]);
    if(previous>row.length)archive.getRange(2,row.length+1,1,previous-row.length).clearContent();
    SpreadsheetApp.flush();
    if(String(archive.getRange(2,1).getDisplayValue())!==String(state.epoch))
      throw new Error('archive_write_not_confirmed');
    return {ok:true,epoch:state.epoch,lastUpdated:snapshot.lastUpdated};
  }finally{lock.releaseLock();}
}
function archivedSnapshot_(){
  const state=eventState_(),tab=archiveSheet_(false);
  if(!tab || tab.getLastRow()<2)return {ok:true,snapshot:null,event:{phase:state.phase,epoch:state.epoch}};
  const row=tab.getRange(2,1,1,Math.max(4,tab.getLastColumn())).getValues()[0];
  const epoch=Number(row[0]),length=Number(row[2]);
  if(epoch!==state.epoch || !Number.isSafeInteger(length)||length<1||length>15)
    return {ok:true,snapshot:null,event:{phase:state.phase,epoch:state.epoch}};
  const raw=row.slice(3,3+length).join('');
  const snapshot=JSON.parse(raw);
  if(!snapshot || snapshot.ok!==true ||
     snapshot.eventEpoch!==state.epoch ||
     snapshot.eventStartTW!==state.startTW ||
     snapshot.eventEndTW!==state.endTW ||
     snapshot.eventPhase!=='OFFICIAL')
    throw new Error('archive_invalid');
  return {ok:true,snapshot:snapshot,event:{phase:state.phase,epoch:state.epoch}};
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
    if(!['CCB','OFFICIAL'].includes(eventState_().phase))return {ok:false,error:'event_paused'};
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
    if(e.postData.contents.length>350000)return respond_({ok:false,error:'payload_too_large'});
    const input=JSON.parse(e.postData.contents);
    const secret=PropertiesService.getScriptProperties().getProperty('SDX_REGISTRATION_SECRET')||'';
    if(secret.length<32 || typeof input.secret!=='string' || input.secret!==secret)
      return respond_({ok:false,error:'unauthorized'});
    const sh=sheet_();
    if(input.action==='status')return respond_({ok:true,enabled:true,spreadsheetId:SDX_SPREADSHEET_ID,event:eventSummary_(sh)});
    if(input.action==='eventStatus')return respond_({ok:true,event:eventSummary_(sh)});
    if(input.action==='aids')return respond_({ok:true,enabled:true,aids:aids_(sh),eventCode:SDX_EVENT,event:eventSummary_(sh)});
    if(input.action==='register')return respond_(register_(sh,input));
    if(input.action==='clearCcb')return respond_(clearCcb_(sh,input));
    if(input.action==='startOfficial')return respond_(startOfficial_(sh,input));
    if(input.action==='persistSnapshot')return respond_(persistSnapshot_(sh,input));
    if(input.action==='getSnapshot')return respond_(archivedSnapshot_());
    return respond_({ok:false,error:'invalid_action'});
  }catch(err){
    // Never return AIDs, names, credentials or raw record contents.
    const known=['sheet_missing','sheet_headers_changed','sheet_readback_mismatch','registration_busy','invalid_registration','aid_already_registered','invalid_event_state','event_busy','event_paused','official_data_protected','confirmation_required','clear_readback_failed','must_clear_ccb_first','registrations_not_empty','invalid_event_dates','event_not_running','archive_snapshot_invalid','archive_too_large','archive_write_not_confirmed','archive_invalid'];
    const code=known.includes(String(err.message))?String(err.message):'backend_error';
    return respond_({ok:false,error:code});
  }
}
function doGet() {return respond_({ok:false,error:'post_required'});}
