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
  return {schemaVersion:5,phase:state.phase,epoch:state.epoch,startTW:state.startTW,
          endTW:state.endTW,registeredCount:aids_(sh).length,
          resetComplete:state.phase==='READY'&&state.resetComplete===true};
}

function currentEventRows_(sh){
  const last=sh.getLastRow();
  if(last<2)return [];
  const codes=sh.getRange(2,4,last-1,1).getDisplayValues();
  const rows=[];
  codes.forEach((r,i)=>{if(String(r[0]||'').trim()===SDX_EVENT)rows.push(i+2)});
  return rows;
}

/* CCB reset v4: clear only derived event data. Preserve headers, formatting,
 * dropdown validations and pre-existing formulas. Never touch rules/config. */
const SDX_CCB_DATA_TABS=[
  {name:'玩家公開榜單',
   headers:['活動識別','機台代碼','排名類型','AID公開代號','暱稱','累積押碼','單把最高倍率','名次','成績時間','資料同步時間'],
   eventColumn:0},
  {name:'機台原始紀錄',
   headers:['紀錄唯一ID','機台代碼','機台後台ID','玩家AID','玩家暱稱','投注時間','有效押碼','中獎倍數','單把獲獎','後台狀態','匯入時間']},
  {name:'同步紀錄',
   headers:['同步時間','同步來源','機台代碼','匯入筆數','結果','錯誤摘要','最後後台游標']},
  {name:'雙神活動公開快照',
   headers:['活動世代','最後同步時間','JSON片段數','公開榜單JSON（D欄起分段）'],allColumns:true}
];
function assertCcbTabHeader_(tab,headers){
  if(!tab)return; // Never-created archive has no test data.
  const existing=tab.getRange(1,1,1,headers.length).getDisplayValues()[0];
  if(existing.some((value,index)=>value!==headers[index]))
    throw new Error('ccb_sheet_headers_changed');
}
function clearCcbTabData_(tab,headers,opts){
  if(!tab)return 0;
  assertCcbTabHeader_(tab,headers);
  const count=tab.getLastRow()-1;
  if(count<=0)return 0;
  const width=(opts&&opts.allColumns)?Math.max(headers.length,tab.getLastColumn()):headers.length;
  const range=tab.getRange(2,1,count,width);
  const values=range.getValues(),formulas=range.getFormulas();
  const eventColumn=opts&&Number.isInteger(opts.eventColumn)?opts.eventColumn:null;
  const included=values.map(row=>eventColumn===null || String(row[eventColumn]||'').trim()===SDX_EVENT);
  const filled=values.reduce((n,row,i)=>n+(included[i]&&row.some((value,j)=>!formulas[i][j]&&value!==''&&value!==null&&value!==undefined)?1:0),0);
  // Batch contiguous rows with identical formula masks; never clear formula cells.
  for(let i=0;i<count;){
    if(!included[i]){i++;continue;}
    const mask=formulas[i].map(value=>Boolean(value));
    let end=i+1;
    while(end<count&&included[end]&&formulas[end].every((value,j)=>Boolean(value)===mask[j]))end++;
    for(let c=0;c<width;){
      if(mask[c]){c++;continue;}
      let endCol=c+1;
      while(endCol<width&&!mask[endCol])endCol++;
      tab.getRange(i+2,c+1,end-i,endCol-c).clearContent();
      c=endCol;
    }
    i=end;
  }
  const after=range.getValues(),afterFormulas=range.getFormulas();
  for(let i=0;i<count;i++){
    if(!included[i])continue;
    for(let c=0;c<width;c++){
      if(formulas[i][c]){
        if(afterFormulas[i][c]!==formulas[i][c])throw new Error('ccb_formula_not_preserved');
      }else if(after[i][c]!==''&&after[i][c]!==null&&after[i][c]!==undefined)
        throw new Error('ccb_data_not_cleared');
    }
  }
  return filled;
}

function clearCcb_(sh,body){
  if(body.confirm!=='清空CCB資料')return {ok:false,error:'confirmation_required'};
  const lock=LockService.getScriptLock();
  if(!lock.tryLock(20000))return {ok:false,error:'event_busy'};
  try{
    const old=eventState_();
    if(!['CCB','READY'].includes(old.phase))return {ok:false,error:'official_data_protected'};
    // Validate every destination BEFORE entering READY or deleting data.
    const book=SpreadsheetApp.openById(SDX_SPREADSHEET_ID);
    SDX_CCB_DATA_TABS.forEach(spec=>
      assertCcbTabHeader_(book.getSheetByName(spec.name),spec.headers));
    Object.keys(SDX_AWARD_TABS).forEach(kind=>{
      const cfg=SDX_AWARD_TABS[kind];
      assertCcbTabHeader_(book.getSheetByName(cfg.name),cfg.headers);
    });
    if(old.phase==='CCB')setEventState_({
      phase:'READY',epoch:old.epoch+1,startTW:'',resetComplete:false,
      clearedAt:new Date().toISOString()
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
    const clearedTabs={'玩家登記與派獎':count};
    SDX_CCB_DATA_TABS.forEach(spec=>{
      const tab=book.getSheetByName(spec.name);
      clearedTabs[spec.name]=clearCcbTabData_(tab,spec.headers,spec);
    });
    Object.assign(clearedTabs,clearAwardLedger_(book));
    SpreadsheetApp.flush();
    if(currentEventRows_(sh).length!==0)throw new Error('clear_readback_failed');
    if(archivedSnapshot_().snapshot!==null)throw new Error('ccb_archive_not_cleared');
    // Mark READY as safe for official launch only after ALL readbacks passed.
    setEventState_(Object.assign({},eventState_(),{resetComplete:true}));
    return {ok:true,cleared:count,clearedTabs,event:eventSummary_(sh)};
  } finally{lock.releaseLock();}
}
function startOfficial_(sh,body){
  if(body.confirm!=='啟動正式活動')return {ok:false,error:'confirmation_required'};
  const lock=LockService.getScriptLock();
  if(!lock.tryLock(20000))return {ok:false,error:'event_busy'};
  try{
    const old=eventState_();
    if(old.phase!=='READY')return {ok:false,error:'must_clear_ccb_first'};
    if(old.resetComplete!==true)return {ok:false,error:'ccb_reset_incomplete'};
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


/* Durable public-only snapshot for CCB, OFFICIAL, and ENDED activity views.
 * The Google Sheet stores a sanitized B2B snapshot, never an AID,
 * full name, session, wager receipt, or cookie. It is overwritten within
 * the same active epoch, and becomes immutable when official activity ends.
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

/** Payout workbooks are manager-only. The live public archive never contains
 * registration AIDs or legal names, and nobody is marked paid automatically.
 * Every update uses the same whitelisted B2B snapshot as the public website. */
const SDX_AWARD_TABS={
  BET:{name:'後勤_累積投注榜',
    headers:['活動世代','活動階段','機台','名次','AID','真實姓名','玩家暱稱','累積投注額','預估獎金NTD','派獎資格','最後同步時間']},
  MULT:{name:'後勤_單把倍率榜',
    headers:['活動世代','活動階段','機台','名次','AID','真實姓名','玩家暱稱','單把最高倍率','預估獎金NTD','派獎資格','最後同步時間']},
  ACH:{name:'後勤_個人成就榜',
    headers:['活動世代','活動階段','機台','AID','真實姓名','玩家暱稱','累積投注額','8萬達標','28萬達標','68萬達標','累積階數','預估獎金NTD','派獎資格','最後同步時間']},
  TOTAL:{name:'後勤_派獎總表',
    headers:['活動世代','活動階段','AID','真實姓名','玩家暱稱','賽特投注榜','雷神投注榜','賽特倍率榜','雷神倍率榜','賽特成就獎','雷神成就獎','預估總獎金NTD','人工核定金額','後勤派獎狀態','實際已派金額','派獎日期','後勤備註','最後同步時間']}
};
const SDX_RANK_REWARDS=[400,250,150,100,100,50,50,50,50,50];
function safeCell_(value){
  if(typeof value==='string'){
    const trimmed=value.replace(/[\x00-\x1f\x7f]/g,' ').slice(0,80);
    return /^[=+\-@]/.test(trimmed)?'\u0027'+trimmed:trimmed;
  }
  return value===null||value===undefined?'':value;
}
function awardTab_(book,kind){
  const config=SDX_AWARD_TABS[kind];
  let tab=book.getSheetByName(config.name);
  if(!tab){
    tab=book.insertSheet(config.name);
    tab.getRange(1,1,1,config.headers.length).setValues([config.headers]);
    tab.setFrozenRows(1);
  }else{
    const existing=tab.getRange(1,1,1,config.headers.length).getDisplayValues()[0];
    if(existing.some((x,i)=>x!==config.headers[i]))throw new Error('award_tab_headers_changed');
  }
  return tab;
}
function overwriteAwardRows_(tab,kind,rows,aidColumn){
  const width=SDX_AWARD_TABS[kind].headers.length,old=tab.getLastRow();
  if(old>1)tab.getRange(2,1,old-1,width).clearContent();
  if(!rows.length)return;
  if(rows.length+1>tab.getMaxRows())tab.insertRowsAfter(tab.getMaxRows(),rows.length+1-tab.getMaxRows());
  tab.getRange(2,aidColumn,rows.length,1).setNumberFormat('@');
  tab.getRange(2,1,rows.length,width).setValues(rows.map(row=>row.map(safeCell_)));
}
function registeredAdminMap_(sh){
  const last=sh.getLastRow(),result={};
  if(last<2)return result;
  const rows=sh.getRange(2,2,last-1,5).getDisplayValues();
  rows.forEach(row=>{
    const aid=String(row[0]||'').trim();
    if(!/^\d{6,20}$/.test(aid) || row[2]!==SDX_EVENT ||
       row[3]==='已取消'||row[4]!=='AID已驗證')return;
    if(result[aid])throw new Error('award_registration_duplicate');
    result[aid]={name:String(row[1]||'').trim()};
    if(!result[aid].name)throw new Error('award_registration_missing_name');
  });
  return result;
}
function validateAwardLedger_(sh,ledger,snapshot){
  if(!ledger||typeof ledger!=='object'||Array.isArray(ledger)||
     ledger.eventEpoch!==snapshot.eventEpoch||
     ledger.lastUpdated!==snapshot.lastUpdated||
     !ledger.machineRows||Object.keys(ledger.machineRows).sort().join(',')!=='SET2,THOR')
    throw new Error('award_ledger_invalid');
  const registered=registeredAdminMap_(sh);
  const roster=ledger.registeredAids;
  if(!Array.isArray(roster)||roster.length>200||new Set(roster).size!==roster.length||
     roster.length!==(snapshot.luckboard.ALL||[]).length||
     roster.some(aid=>typeof aid!=='string'||!/^\d{6,20}$/.test(aid)||!registered[aid]))
    throw new Error('award_ledger_roster_invalid');
  const eligible=new Set(roster);
  for(const code of ['SET2','THOR']){
    const g=ledger.machineRows[code];
    if(!g||Object.keys(g).sort().join(',')!=='ACH,BET,MULT')
      throw new Error('award_ledger_invalid');
    for(const kind of ['BET','MULT','ACH']){
      if(!Array.isArray(g[kind])||g[kind].length>(kind==='ACH'?200:10))
        throw new Error('award_ledger_invalid');
      const seen={};
      g[kind].forEach((row,i)=>{
        if(!row||typeof row.aid!=='string'||!/^\d{6,20}$/.test(row.aid)||
           !registered[row.aid]||!eligible.has(row.aid)||seen[row.aid]||
           typeof row.nickname!=='string'||row.nickname.length>32)
          throw new Error('award_unverified_aid');
        seen[row.aid]=true;
        if(kind!=='ACH'){
          const pub=snapshot.rankings[code][kind][i];
          if(!pub||pub.rank!==row.rank||pub.nickname!==row.nickname||
             Math.abs(pub.score-row.score)>0.00001)
            throw new Error('award_public_mismatch');
        }else{
          if(!(typeof row.bet==='number' && Number.isFinite(row.bet) && row.bet>=80000) ||
             !(snapshot.luckboard[code]||[]).some(p=>p.nickname===row.nickname&&Math.abs(p.bet-row.bet)<0.011))
            throw new Error('award_public_mismatch');
        }
      });
      if(kind!=='ACH'&&g[kind].length!==snapshot.rankings[code][kind].length)
        throw new Error('award_public_mismatch');
    }
  }
  return registered;
}
function readManualPayout_(tab,epoch){
  const data={},last=tab.getLastRow();
  if(last<2)return data;
  const rows=tab.getRange(2,1,last-1,18).getValues();
  rows.forEach(row=>{
    const aid=String(row[2]||'').trim();
    if(Number(row[0])!==epoch||!/^\d{6,20}$/.test(aid)||data[aid])return;
    const keepNumberOrDate=value=>value===null||value===undefined?'':value;
    data[aid]=[keepNumberOrDate(row[12]),row[13]||'未派獎',
      keepNumberOrDate(row[14]),keepNumberOrDate(row[15]),keepNumberOrDate(row[16])];
  });
  return data;
}
function writeAwardLedger_(sh,ledger,snapshot){
  const registered=validateAwardLedger_(sh,ledger,snapshot);
  const book=SpreadsheetApp.openById(SDX_SPREADSHEET_ID);
  const totalTab=awardTab_(book,'TOTAL');
  const kept=readManualPayout_(totalTab,snapshot.eventEpoch);
  const stage=snapshot.eventPhase==='CCB'?'CCB 測試（不可派獎）':'正式進行中（待結算）';
  const audit=snapshot.eventPhase==='CCB'?'測試資料／不可派獎':'待主辦核對／非已核定';
  const machines={SET2:'戰神賽特 II',THOR:'雷神之錘'};
  const bet=[],mult=[],ach=[],totals={};
  ledger.registeredAids.forEach(aid=>{
    totals[aid]={aid,name:registered[aid].name,nickname:'尚無遊戲紀錄',
      BET_SET2:0,BET_THOR:0,MULT_SET2:0,MULT_THOR:0,ACH_SET2:0,ACH_THOR:0};
  });
  for(const code of ['SET2','THOR']){
    const game=ledger.machineRows[code],label=machines[code];
    for(const kind of ['BET','MULT']){
      game[kind].forEach(item=>{
        const prize=SDX_RANK_REWARDS[item.rank-1];
        if(!Number.isFinite(prize))throw new Error('award_rank_invalid');
        const rec=totals[item.aid];
        rec.nickname=item.nickname;
        rec[kind+'_'+code]=prize;
        const line=[snapshot.eventEpoch,stage,label,item.rank,item.aid,
          rec.name,item.nickname,item.score,prize,audit,snapshot.lastUpdated];
        (kind==='BET'?bet:mult).push(line);
      });
    }
    game.ACH.forEach(item=>{
      const steps=[80000,280000,680000].map(threshold=>item.bet>=threshold?1:0);
      const prize=steps.reduce((a,b)=>a+b,0)*50;
      const rec=totals[item.aid];
      if(rec.nickname==='尚無遊戲紀錄')rec.nickname=item.nickname;
      rec['ACH_'+code]=prize;
      ach.push([snapshot.eventEpoch,stage,label,item.aid,rec.name,item.nickname,
        item.bet,...steps,steps.reduce((a,b)=>a+b,0),prize,audit,snapshot.lastUpdated]);
    });
  }
  const totalRows=Object.values(totals).sort((a,b)=>a.aid.localeCompare(b.aid)).map(item=>{
    const keys=['BET_SET2','BET_THOR','MULT_SET2','MULT_THOR','ACH_SET2','ACH_THOR'];
    const values=keys.map(key=>item[key]),sum=values.reduce((a,b)=>a+b,0);
    const manual=kept[item.aid]||['','未派獎','','',''];
    return [snapshot.eventEpoch,stage,item.aid,item.name,item.nickname,
      ...values,sum,...manual,snapshot.lastUpdated];
  });
  overwriteAwardRows_(awardTab_(book,'BET'),'BET',bet,5);
  overwriteAwardRows_(awardTab_(book,'MULT'),'MULT',mult,5);
  overwriteAwardRows_(awardTab_(book,'ACH'),'ACH',ach,4);
  overwriteAwardRows_(totalTab,'TOTAL',totalRows,3);
  SpreadsheetApp.flush();
  return {ok:true,counts:{bet:bet.length,mult:mult.length,achievement:ach.length,
    participants:totalRows.length}};
}
function clearAwardLedger_(book){
  const result={};
  Object.keys(SDX_AWARD_TABS).forEach(kind=>{
    const cfg=SDX_AWARD_TABS[kind];
    result[cfg.name]=clearCcbTabData_(book.getSheetByName(cfg.name),cfg.headers,{});
  });
  return result;
}

function persistSnapshot_(sh,body){
  const lock=LockService.getScriptLock();
  if(!lock.tryLock(20000))return {ok:false,error:'event_busy'};
  try{
    const state=eventState_(),snapshot=body.snapshot;
    if(!['CCB','OFFICIAL'].includes(state.phase))return {ok:false,error:'event_not_running'};
    if(!snapshot || typeof snapshot!=='object' || Array.isArray(snapshot) ||
       snapshot.ok!==true || snapshot.eventPhase!==state.phase ||
       snapshot.eventEpoch!==state.epoch ||
       snapshot.eventStartTW!==state.startTW ||
       snapshot.eventEndTW!==state.endTW ||
       !snapshot.rankings || !snapshot.luckboard)
      return {ok:false,error:'archive_snapshot_invalid'};
    if(state.phase==='OFFICIAL'&&!body.awardLedger)
      return {ok:false,error:'award_ledger_required'};
    // Reject unmatched/unverified payout identities before mutating any tab.
    if(body.awardLedger)validateAwardLedger_(sh,body.awardLedger,snapshot);
    const obj=JSON.stringify(snapshot);
    if(obj.length>300000)return {ok:false,error:'archive_too_large'};
    const chunks=obj.match(/[\s\S]{1,30000}/g)||[];
    let ledgerResult=null;
    if(body.awardLedger)ledgerResult=writeAwardLedger_(sh,body.awardLedger,snapshot);
    const archive=archiveSheet_(true);
    const previous=archive.getLastColumn();
    const row=[state.epoch,snapshot.lastUpdated,chunks.length,...chunks];
    archive.getRange(2,1,1,row.length).setValues([row]);
    if(previous>row.length)archive.getRange(2,row.length+1,1,previous-row.length).clearContent();
    SpreadsheetApp.flush();
    if(String(archive.getRange(2,1).getDisplayValue())!==String(state.epoch))
      throw new Error('archive_write_not_confirmed');
    return {ok:true,epoch:state.epoch,lastUpdated:snapshot.lastUpdated,
      ledgerUpdated:Boolean(ledgerResult&&ledgerResult.ok),
      ledgerUpdatedAt:ledgerResult?snapshot.lastUpdated:null,
      ledgerCounts:ledgerResult?ledgerResult.counts:null};
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
     (snapshot.eventEndTW||'')!==(state.endTW||'') ||
     snapshot.eventPhase!==(state.phase==='ENDED'?'OFFICIAL':state.phase) ||
     !['CCB','OFFICIAL','ENDED'].includes(state.phase))
    throw new Error('archive_invalid');
  return {ok:true,snapshot:snapshot,event:{phase:state.phase,epoch:state.epoch}};
}

const SDX_INITIAL_COINS=20000;
const SDX_INITIAL_HEADERS=['初始金幣','初始金幣派發狀態','初始金幣寄送時間','初始金幣派發單號','初始金幣派發備註'];
function initialHeaders_(sh){
  if(typeof sh.getMaxColumns==='function'&&sh.getMaxColumns()<15)sh.insertColumnsAfter(sh.getMaxColumns(),15-sh.getMaxColumns());
  const actual=sh.getRange(1,11,1,5).getDisplayValues()[0];
  if(SDX_INITIAL_HEADERS.every((v,i)=>actual[i]===v))return;
  if(SDX_INITIAL_HEADERS.some((v,i)=>actual[i]&&actual[i]!==v))throw new Error('initial_reward_headers_changed');
  sh.getRange(1,11,1,5).setValues([SDX_INITIAL_HEADERS]);
  SpreadsheetApp.flush();
}
function initialRows_(sh){
  if(sh.getLastRow()<2)return [];
  return sh.getRange(2,1,sh.getLastRow()-1,15).getDisplayValues().map((v,i)=>({v,row:i+2}))
    .filter(x=>x.v[3]===SDX_EVENT&&x.v[4]==='已登記'&&x.v[5]==='AID已驗證'&&/^\d{6,20}$/.test(x.v[1]));
}
function initialWrite_(sh,row,status,sentAt,claimId,note){
  sh.getRange(row,11,1,5).setValues([[SDX_INITIAL_COINS,status,sentAt||'',claimId||'',note||'']]);
  SpreadsheetApp.flush();
}
function initialReward_(sh,input){
  const lock=LockService.getScriptLock();
  if(!lock.tryLock(18000))return {ok:false,error:'initial_reward_busy'};
  try{
    initialHeaders_(sh);
    const event=eventState_(),props=PropertiesService.getScriptProperties();
    const active=['CCB','OFFICIAL'].includes(event.phase);
    if(input.action==='initialJobs'){
      const jobs=active?initialRows_(sh).filter(x=>String(x.v[10])==='20000'&&x.v[11]==='待寄送')
        .slice(0,10).map(x=>({aid:x.v[1],epoch:event.epoch})):[];
      return {ok:true,jobs};
    }
    const aid=input.aid,claimId=input.claimId;
    if(typeof aid!=='string'||!/^\d{6,20}$/.test(aid)||typeof claimId!=='string'||!/^[a-f0-9]{32}$/.test(claimId))
      return {ok:false,error:'initial_reward_invalid'};
    const key='SDX_INITIAL_DUAL2026_A_'+aid;
    const previous=props.getProperty(key);
    const rows=initialRows_(sh).filter(x=>x.v[1]===aid);
    if(input.action==='initialClaim'){
      if(!active||input.epoch!==event.epoch||rows.length!==1||String(rows[0].v[10])!=='20000'||rows[0].v[11]!=='待寄送')
        return {ok:true,claimed:false};
      const row=rows[0];
      if(previous){
        const saved=JSON.parse(previous);
        initialWrite_(sh,row.row,saved.status,saved.sentAt,saved.claimId,'已有派發紀錄，禁止重複寄送');
        return {ok:true,claimed:false};
      }
      const record={aid,claimId,status:'寄送中／待核對',sentAt:''};
      props.setProperty(key,JSON.stringify(record));
      initialWrite_(sh,row.row,record.status,'',claimId,'已鎖定派發；若中斷須人工核對寄信紀錄');
      return {ok:true,claimed:true,aid,claimId};
    }
    if(input.action!=='initialResult'||!previous||!['sent','uncertain'].includes(input.outcome))
      return {ok:false,error:'initial_reward_invalid'};
    const record=JSON.parse(previous);
    if(record.claimId!==claimId)return {ok:false,error:'initial_reward_invalid'};
    if(record.status!=='已寄送'){
      record.status=input.outcome==='sent'?'已寄送':'異常／待人工核對';
      if(input.outcome==='sent')record.sentAt=Utilities.formatDate(new Date(),'Asia/Taipei','yyyy-MM-dd HH:mm:ss');
      props.setProperty(key,JSON.stringify(record));
    }
    for(const row of rows)if(row.v[13]===claimId)
      initialWrite_(sh,row.row,record.status,record.sentAt,claimId,
        record.status==='已寄送'?'B2B 寄信成功':'寄信未確認；禁止自動重送，請查後台紀錄');
    return {ok:true,status:record.status};
  }finally{lock.releaseLock();}
}

const SDX_RESCUE_COINS=10000;
const SDX_RESCUE_TAB='後勤_救援金派發';
const SDX_RESCUE_HEADERS=['批次單號','活動世代','建立時間（台灣）','AID','救援金額','派發狀態','寄送時間（台灣）','派發單號','備註'];
function rescueTab_(){
  const book=SpreadsheetApp.openById(SDX_SPREADSHEET_ID);
  let tab=book.getSheetByName(SDX_RESCUE_TAB);
  if(!tab){tab=book.insertSheet(SDX_RESCUE_TAB);tab.getRange(1,1,1,9).setValues([SDX_RESCUE_HEADERS]);tab.setFrozenRows(1);SpreadsheetApp.flush();}
  const header=tab.getRange(1,1,1,9).getDisplayValues()[0];
  if(!SDX_RESCUE_HEADERS.every((v,i)=>header[i]===v))throw new Error('rescue_headers_changed');
  return tab;
}
function rescueRows_(tab){
  return tab.getLastRow()<2?[]:tab.getRange(2,1,tab.getLastRow()-1,9).getDisplayValues().map((v,i)=>({v,row:i+2}));
}
function rescueSummary_(rows,batchId){
  const selected=rows.filter(x=>x.v[0]===batchId);
  return {batchId,total:selected.length,coins:selected.length*SDX_RESCUE_COINS,
    pending:selected.filter(x=>x.v[5]==='待寄送').length,
    sending:selected.filter(x=>x.v[5]==='寄送中／待核對').length,
    sent:selected.filter(x=>x.v[5]==='已寄送').length,
    uncertain:selected.filter(x=>x.v[5]==='異常／待人工核對').length,
    cancelled:selected.filter(x=>x.v[5]==='已取消').length};
}
function rescueReward_(sh,input){
  const lock=LockService.getScriptLock();
  if(!lock.tryLock(18000))return {ok:false,error:'rescue_busy'};
  try{
    const event=eventState_(),active=['CCB','OFFICIAL'].includes(event.phase);
    const tab=rescueTab_(),rows=rescueRows_(tab);
    const current=rows.filter(x=>Number(x.v[1])===event.epoch);
    const batchId=input.batchId;
    const latest=current.length?rescueSummary_(current,current[current.length-1].v[0]):null;
    if(input.action==='rescueStatus')return {ok:true,batch:latest,enabled:active};
    if(input.action==='rescueStart'){
      if(typeof batchId!=='string'||!/^[a-f0-9]{32}$/.test(batchId)||input.confirm!=='派發救援金')
        return {ok:false,error:'rescue_invalid'};
      if(rows.some(x=>x.v[0]===batchId))return {ok:true,batch:rescueSummary_(rows,batchId),duplicate:true};
      if(!active||input.epoch!==event.epoch)return {ok:false,error:'event_paused'};
      if(current.some(x=>['待寄送','寄送中／待核對','異常／待人工核對'].includes(x.v[5])))
        return {ok:false,error:'rescue_batch_unresolved'};
      const ids=[...new Set(initialRows_(sh).map(x=>x.v[1]))];
      if(!ids.length||ids.length>200||ids.some(a=>!Number.isSafeInteger(Number(a))||Number(a)<=0||String(Number(a))!==a))
        return {ok:false,error:'rescue_roster_invalid'};
      if(input.expectedCount!==ids.length)return {ok:false,error:'rescue_roster_changed'};
      const now=Utilities.formatDate(new Date(),'Asia/Taipei','yyyy-MM-dd HH:mm:ss');
      const start=tab.getLastRow()+1;
      if(start+ids.length-1>tab.getMaxRows())tab.insertRowsAfter(tab.getMaxRows(),start+ids.length-1-tab.getMaxRows());
      tab.getRange(start,4,ids.length,1).setNumberFormat('@');
      tab.getRange(start,1,ids.length,9).setValues(ids.map(aid=>[batchId,event.epoch,now,aid,SDX_RESCUE_COINS,'待寄送','','','']));
      SpreadsheetApp.flush();
      return {ok:true,batch:rescueSummary_(rescueRows_(tab),batchId)};
    }
    if(input.action==='rescueJobs'){
      const jobs=active?current.filter(x=>x.v[5]==='待寄送').slice(0,10).map(x=>({batchId:x.v[0],epoch:event.epoch,aid:x.v[3]})):[];
      return {ok:true,jobs};
    }
    const aid=input.aid,claimId=input.claimId;
    if(typeof batchId!=='string'||!/^[a-f0-9]{32}$/.test(batchId)||typeof aid!=='string'||!/^\d{6,20}$/.test(aid)||
      typeof claimId!=='string'||!/^[a-f0-9]{32}$/.test(claimId))return {ok:false,error:'rescue_invalid'};
    const found=rows.filter(x=>x.v[0]===batchId&&x.v[3]===aid);
    if(found.length!==1)return {ok:false,error:'rescue_record_invalid'};
    const item=found[0],v=item.v;
    if(input.action==='rescueClaim'){
      if(!active||input.epoch!==event.epoch||Number(v[1])!==event.epoch||v[5]!=='待寄送'||String(v[4])!=='10000')
        return {ok:true,claimed:false};
      if(!initialRows_(sh).some(x=>x.v[1]===aid)){
        tab.getRange(item.row,6,1,4).setValues([['已取消','','','AID 已不在有效登記名單']]);SpreadsheetApp.flush();
        return {ok:true,claimed:false};
      }
      tab.getRange(item.row,6,1,4).setValues([['寄送中／待核對','',claimId,'已鎖定；中斷不得自動重寄']]);
      SpreadsheetApp.flush();
      const saved=tab.getRange(item.row,6,1,4).getDisplayValues()[0];
      if(saved[0]!=='寄送中／待核對'||saved[2]!==claimId)throw new Error('rescue_claim_unconfirmed');
      return {ok:true,claimed:true,batchId,aid,claimId};
    }
    if(input.action!=='rescueResult'||v[7]!==claimId||!['sent','uncertain'].includes(input.outcome)||
       !['寄送中／待核對','異常／待人工核對','已寄送'].includes(v[5]))return {ok:false,error:'rescue_invalid'};
    if(v[5]!=='已寄送'){
      const sent=input.outcome==='sent',stamp=sent?Utilities.formatDate(new Date(),'Asia/Taipei','yyyy-MM-dd HH:mm:ss'):'';
      tab.getRange(item.row,6,1,4).setValues([[sent?'已寄送':'異常／待人工核對',stamp,claimId,sent?'B2B 寄信成功':'未確認；請人工核對後台']]);
      SpreadsheetApp.flush();
    }
    return {ok:true};
  }finally{lock.releaseLock();}
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
    initialHeaders_(sh);
    const when=Utilities.formatDate(new Date(),'Asia/Taipei','yyyy-MM-dd HH:mm:ss');
    const row=[when,aid,name,SDX_EVENT,'已登記','AID已驗證','待確認','未派獎','',new Date().toISOString(),SDX_INITIAL_COINS,'待寄送','','',''];
    const nextRow=sh.getLastRow()+1;
    // AID must be text; never let Sheets round long numeric identifiers.
    sh.getRange(nextRow,2).setNumberFormat('@');
    sh.getRange(nextRow,1,1,15).setValues([row]);
    SpreadsheetApp.flush();
    const actual=sh.getRange(sh.getLastRow(),1,1,10).getDisplayValues()[0];
    if(actual[1]!==aid || actual[3]!==SDX_EVENT || actual[2]!==name)
      throw new Error('sheet_readback_mismatch');
    return {ok:true,status:'pending_review',registeredAt:when,initialRewardQueued:true};
  }finally{lock.releaseLock();}
}

/* Manual top-up requests are financial records, never included in CCB cleanup.
 * This public endpoint is callable only by Render with the Script secret.
 * Staff, not the website, verify money received and actual coins issued. */
const SDX_TOPUP_TAB='後勤_儲值審核';
const SDX_TOPUP_COINS_PER_NTD=50;
const SDX_TOPUP_HEADERS=[
  '申請編號','申請時間（台灣）','活動世代','玩家AID（僅後勤）',
  '申請金額NTD','應發金幣','審核結果','收款核實','實收金額NTD',
  '實發金幣','發幣核實','後勤經辦','完成核實時間（台灣）',
  '後勤備註','前台成功狀態（自動）'
];
function topupTab_(){
  const tab=SpreadsheetApp.openById(SDX_SPREADSHEET_ID).getSheetByName(SDX_TOPUP_TAB);
  if(!tab)throw new Error('topup_tab_missing');
  const found=tab.getRange(1,1,1,SDX_TOPUP_HEADERS.length).getDisplayValues()[0];
  if(SDX_TOPUP_HEADERS.some((name,i)=>found[i]!==name))throw new Error('topup_headers_changed');
  return tab;
}
function topupLastRecordRow_(tab){
  // O2 contains an ARRAYFORMULA. Do not let formula-spilled blank rows make
  // getLastRow() appear full, or the first application may be rejected.
  const max=tab.getMaxRows();
  if(max<2)return 1;
  const ids=tab.getRange(2,1,max-1,1).getDisplayValues();
  for(let i=ids.length-1;i>=0;i--){
    if(String(ids[i][0]||'').trim()!=='')return i+2;
  }
  return 1;
}
function topupAmount_(value){
  const amount=typeof value==='number'?value:NaN;
  return Number.isSafeInteger(amount)&&amount>=100&&amount<=500&&amount%100===0 ? amount:null;
}
function submitTopup_(registration,input){
  const aid=typeof input.aid==='string'?input.aid.trim():'';
  const amount=topupAmount_(input.amount);
  const id=typeof input.requestId==='string'?input.requestId:'';
  if(!/^\d{6,20}$/.test(aid)||amount===null||
     !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)||
     input.consent!==true)return {ok:false,error:'topup_invalid'};
  const lock=LockService.getScriptLock();
  if(!lock.tryLock(20000))return {ok:false,error:'topup_busy'};
  try{
    const state=eventState_();
    if(!['CCB','OFFICIAL'].includes(state.phase))return {ok:false,error:'topup_event_paused'};
    // AID must have passed the existing, official registration verification.
    const registered=registeredAdminMap_(registration);
    if(!registered[aid])return {ok:false,error:'topup_not_registered'};
    const tab=topupTab_();
    const last=topupLastRecordRow_(tab);
    const existing=last>=2?tab.getRange(2,1,last-1,7).getDisplayValues():[];
    let allocated=0;
    for(const row of existing){
      if(row[0]===id){
        if(row[3]!==aid||Number(String(row[4]).replace(/,/g,''))!==amount)
          return {ok:false,error:'topup_request_conflict'};
        return {ok:true,status:'pending_review',requestId:id,duplicate:true};
      }
      if(row[3]!==aid||row[6]==='已駁回')continue;
      const value=Number(String(row[4]).replace(/,/g,''));
      if(!Number.isFinite(value)||value<=0)throw new Error('topup_records_invalid');
      allocated+=value;
    }
    if(allocated+amount>500)
      return {ok:false,error:'topup_limit_exceeded',remaining:Math.max(0,500-allocated)};
    const next=last+1;
    if(next>tab.getMaxRows())return {ok:false,error:'topup_table_full'};
    const timestamp=Utilities.formatDate(new Date(),'Asia/Taipei','yyyy-MM-dd HH:mm:ss');
    tab.getRange(next,1).setNumberFormat('@');
    tab.getRange(next,4).setNumberFormat('@');
    tab.getRange(next,1,1,14).setValues([[
      id,timestamp,state.epoch,aid,amount,amount*SDX_TOPUP_COINS_PER_NTD,
      '待審核','未確認','','','未發放','','',''
    ]]);
    SpreadsheetApp.flush();
    const check=tab.getRange(next,1,1,6).getDisplayValues()[0];
    if(check[0]!==id||check[3]!==aid||
       Number(String(check[4]).replace(/,/g,''))!==amount)
      throw new Error('topup_write_not_confirmed');
    return {ok:true,status:'pending_review',requestId:id,requestedAt:timestamp,amount,coins:amount*SDX_TOPUP_COINS_PER_NTD};
  }finally{lock.releaseLock()}
}
function publicTopupHistory_(){
  const tab=topupTab_(),last=topupLastRecordRow_(tab);
  if(last<2)return {ok:true,records:[]};
  const rows=tab.getRange(2,1,last-1,15).getValues();
  const records=[];
  rows.forEach(row=>{
    const aid=String(row[3]||'').trim(),amount=Number(row[4]),coins=Number(row[5]);
    if(!/^\d{6,20}$/.test(aid)||topupAmount_(amount)===null||
       coins!==amount*SDX_TOPUP_COINS_PER_NTD||row[6]!=='已核准'||row[7]!=='已確認'||
       Number(row[8])!==amount||Number(row[9])!==coins||
       row[10]!=='已發放'||!String(row[11]||'').trim()||
       !String(row[12]||'').trim())return;
    const date=row[12] instanceof Date
      ?Utilities.formatDate(row[12],'Asia/Taipei','yyyy-MM-dd HH:mm:ss')
      :String(row[12]);
    records.push({aidMasked:'****'+aid.slice(-4),amount,coins,completedAt:date});
  });
  records.sort((a,b)=>b.completedAt.localeCompare(a.completedAt));
  return {ok:true,records:records.slice(0,30)};
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
    if(['initialJobs','initialClaim','initialResult'].includes(input.action))return respond_(initialReward_(sh,input));
    if(['rescueStatus','rescueStart','rescueJobs','rescueClaim','rescueResult'].includes(input.action))return respond_(rescueReward_(sh,input));
    if(input.action==='topupConfig')return respond_({ok:true,rate:SDX_TOPUP_COINS_PER_NTD,limitNTD:500,minAmount:100,maxAmount:500,step:100});
    if(input.action==='topupSubmit')return respond_(submitTopup_(sh,input));
    if(input.action==='topupPublic')return respond_(publicTopupHistory_());
    if(input.action==='clearCcb')return respond_(clearCcb_(sh,input));
    if(input.action==='startOfficial')return respond_(startOfficial_(sh,input));
    if(input.action==='persistSnapshot')return respond_(persistSnapshot_(sh,input));
    if(input.action==='getSnapshot')return respond_(archivedSnapshot_());
    return respond_({ok:false,error:'invalid_action'});
  }catch(err){
    // Never return AIDs, names, credentials or raw record contents.
    const known=['sheet_missing','sheet_headers_changed','sheet_readback_mismatch','registration_busy','invalid_registration','aid_already_registered','invalid_event_state','event_busy','event_paused','official_data_protected','confirmation_required','clear_readback_failed','must_clear_ccb_first','registrations_not_empty','invalid_event_dates','event_not_running','archive_snapshot_invalid','archive_too_large','archive_write_not_confirmed','archive_invalid','award_tab_headers_changed',
    'award_ledger_invalid','award_unverified_aid','award_public_mismatch','award_rank_invalid','award_ledger_required',
    'award_registration_duplicate','award_registration_missing_name','award_ledger_roster_invalid','ccb_sheet_headers_changed','ccb_formula_not_preserved','ccb_data_not_cleared','ccb_archive_not_cleared','ccb_reset_incomplete','topup_tab_missing','topup_headers_changed','topup_records_invalid','topup_write_not_confirmed'];
    const code=known.includes(String(err.message))?String(err.message):'backend_error';
    return respond_({ok:false,error:code});
  }
}
function doGet() {return respond_({ok:false,error:'post_required'});}
