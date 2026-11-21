'use strict';
/**
 * SD x 贏麻了 / read-only B2B leaderboard gateway.
 * No credentials, AIDs, raw tickets or real names are sent to the browser.
 */
const http = require('node:http');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { URL } = require('node:url');
const sheets = require('./sheets');

const PORT = Number(process.env.PORT || 3000);
const ORIGIN = 'https://sdx-winmalo-internal-event-2026.onrender.com';
const API_BASE = 'https://admin-b2b.winmalo.com:9032/api/';
const REFRESH_MS = 60_000;
const MAX_NICKNAME = 32;
const MACHINE_CODES = ['SET2', 'THOR'];
let authCookie = '';
let cache = null;
let running = null;
const SNAPSHOT_FILE = process.env.SDX_SNAPSHOT_PATH || path.join(os.tmpdir(),'sdx-b2b-public-ranking.json');
const MAX_SNAPSHOT_AGE_MS = 15 * 60_000;
let localSnapshot = null;
try {
  const parsed = JSON.parse(fs.readFileSync(SNAPSHOT_FILE, 'utf8'));
  if (parsed && parsed.version === 1 && Date.parse(parsed.lastUpdated)) localSnapshot = parsed;
} catch (_) {}
function protectedTokenMatches(value) {
  const token = process.env.B2B_SYNC_TOKEN || '';
  if (token.length < 32 || !value || typeof value !== 'string') return false;
  const got = value.startsWith('Bearer ') ? value.slice(7) : '';
  const a = Buffer.from(token, 'utf8'), b = Buffer.from(got, 'utf8');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function adminAuthorized(header){
  const expected=process.env.ADMIN_RESET_TOKEN||'';
  if(expected.length<40 || typeof header!=='string' || !header.startsWith('Bearer '))return false;
  const x=Buffer.from(expected,'utf8'),y=Buffer.from(header.slice(7),'utf8');
  return x.length===y.length && crypto.timingSafeEqual(x,y);
}
function clearTransientEventData(){
  localSnapshot=null;
  cache=null;
  for(const job of registrationJobs.values()){
    if(['queued','verifying','writing','registered'].includes(job.state)){
      job.state='timeout';
    }
    job.aid='';job.name='';
  }
  try{fs.unlinkSync(SNAPSHOT_FILE)}catch(e){if(e.code!=='ENOENT')console.warn('Local ranking cache invalidation failed');}
}
function eventSnapshotMatches(snapshot,event){
  return !!(snapshot&&snapshot.ok&&event&&
    snapshot.eventEpoch===event.epoch&&snapshot.eventPhase===event.phase&&
    snapshot.eventStartTW===(event.phase==='OFFICIAL'?event.startTW:'')&&
    (snapshot.eventEndTW||'')===(event.phase==='OFFICIAL'?event.endTW:''));
}
function eventWindowMillis(value){
  if(typeof value!=='string'||!/^\d{4}\/\d{2}\/\d{2} \d{2}:\d{2}:\d{2}$/.test(value))return NaN;
  const stamp=Date.parse(value.replaceAll('/','-').replace(' ','T')+'+08:00');
  if(!Number.isFinite(stamp))return NaN;
  const actual=new Date(stamp+8*3600*1000).toISOString().slice(0,19).replace('T',' ');
  return actual===value.replaceAll('/','-')?stamp:NaN;
}
function completedSnapshotMatches(snapshot,event){
  return !!(snapshot&&snapshot.ok===true&&event&&event.phase==='ENDED'&&
    snapshot.eventEpoch===event.epoch&&snapshot.eventPhase==='OFFICIAL'&&
    snapshot.eventStartTW===event.startTW&&snapshot.eventEndTW===event.endTW);
}

function validatePublicSnapshot(payload) {
  if (!payload || payload.version !== 1 || payload.source !== 'local-whitelisted-b2b') throw new DataUnavailable('bad_snapshot_schema');
  const timestamp = Date.parse(payload.lastUpdated);
  if (!Number.isFinite(timestamp) || Math.abs(Date.now()-timestamp)>5*60_000) throw new DataUnavailable('bad_snapshot_time');
  if (!payload.rankings || typeof payload.rankings !== 'object') throw new DataUnavailable('bad_snapshot_rankings');
  const rankings = {};
  for (const machine of MACHINE_CODES) {
    const source = payload.rankings[machine];
    if (!source || typeof source !== 'object') throw new DataUnavailable('missing_game_ranking');
    rankings[machine] = {};
    for (const kind of ['BET','MULT']) {
      const input = source[kind];
      if (!Array.isArray(input) || input.length>10) throw new DataUnavailable('bad_ranking_rows');
      const rows = [], seen = new Set();
      for (const row of input) {
        const allowed = ['rank','nickname','score'];
        if (!row || Object.keys(row).some(k=>!allowed.includes(k))) throw new DataUnavailable('unapproved_ranking_field');
        const rank = Number(row.rank), score = Number(row.score);
        const nickname = cleanNickname(row.nickname);
        if (!Number.isInteger(rank) || rank<1 || rank>10 || !Number.isFinite(score) || score<0 || seen.has(rank)) throw new DataUnavailable('bad_ranking_score');
        seen.add(rank); rows.push({rank,nickname,score});
      }
      rankings[machine][kind] = rows.sort((a,b)=>a.rank-b.rank);
    }
  }
  // RTP is a single sanitized, weighted percentage per machine; no raw wagers,
  // payouts, player identities, ticket identifiers or arbitrary nested objects.
  const rtp={SET2:null,THOR:null};
  if(payload.rtp!==undefined) {
    if(!payload.rtp || typeof payload.rtp!=='object' || Array.isArray(payload.rtp) ||
       Object.keys(payload.rtp).some(key=>!MACHINE_CODES.includes(key)))
      throw new DataUnavailable('bad_rtp_schema');
    for(const machine of MACHINE_CODES) {
      const value=payload.rtp[machine];
      if(value===undefined || value===null)continue;
      if(typeof value!=='number' || !Number.isFinite(value) || value<0 || value>1e6)
        throw new DataUnavailable('bad_rtp_value');
      rtp[machine]=Math.round(value*100)/100;
    }
  }
  // Public luckboard accepts ONLY display-safe, per-registered-player fields.
  // Joining by private AID happens on the whitelisted Windows machine.
  let luckboard=null;
  if(payload.luckboard!==undefined) {
    const lb=payload.luckboard;
    if(!lb || typeof lb!=='object' || Array.isArray(lb) ||
       Object.keys(lb).length!==3 ||
       ['ALL','SET2','THOR'].some(k=>!Array.isArray(lb[k])))
      throw new DataUnavailable('invalid_luckboard_structure');
    luckboard={};
    for(const group of ['ALL','SET2','THOR']) {
      const input=lb[group];
      if(input.length>200)throw new DataUnavailable('luckboard_too_many_players');
      luckboard[group]=[];
      let previous=Infinity,prevBet=Infinity,ranked=0,unranked=false;
      for(const row of input) {
        if(!row || typeof row!=='object' || Array.isArray(row) ||
           Object.keys(row).sort().join(',')!=='bet,nickname,rank,rtp,spins')
          throw new DataUnavailable('luckboard_unapproved_field');
        if(typeof row.nickname!=='string' || row.nickname.length>32 ||
           !Number.isInteger(row.spins) || row.spins<0 || row.spins>1e9 ||
           typeof row.bet!=='number' || !Number.isFinite(row.bet) || row.bet<0 || row.bet>1e15)
          throw new DataUnavailable('luckboard_invalid_player');
        const ratio=row.rtp, rank=row.rank;
        const hasRtp=typeof ratio==='number' && Number.isFinite(ratio) &&
          ratio>=0 && ratio<=1e6;
        if(ratio!==null && !hasRtp)throw new DataUnavailable('luckboard_invalid_rtp');
        if(hasRtp) {
          if(unranked || row.bet<=0 || ratio>previous ||
             (ratio===previous && row.bet>prevBet) || rank!==++ranked)
            throw new DataUnavailable('luckboard_sort_invalid');
          previous=ratio;prevBet=row.bet;
        } else {
          if(rank!==null || row.bet!==0)throw new DataUnavailable('luckboard_no_bet_invalid');
          unranked=true;
        }
        luckboard[group].push({rank:hasRtp?rank:null,nickname:cleanNickname(row.nickname),
          spins:row.spins,bet:Math.round(row.bet*100)/100,rtp:hasRtp?Math.round(ratio*100)/100:null});
      }
    }
    if(luckboard.ALL.length!==Math.max(luckboard.SET2.length,luckboard.THOR.length))
      throw new DataUnavailable('luckboard_inconsistent_participants');
  }
  // The public bankruptcy board never stores full AIDs, real names, receipt IDs,
  // account sessions, or private B2B account fields. Missing legacy sync -> unavailable.
  let bankruptcy=null;
  if(payload.bankruptcy!==undefined) {
    const b=payload.bankruptcy;
    if(!b||typeof b!=='object'||Array.isArray(b)||
       Object.keys(b).sort().join(',')!=='checked,count,percentage,rows,status,total'||
       !['ready','unavailable'].includes(b.status)||
       !Number.isInteger(b.total)||b.total<0||b.total>200||
       !Number.isInteger(b.checked)||b.checked<0||b.checked>b.total||
       !Array.isArray(b.rows)||b.rows.length>200)
      throw new DataUnavailable('invalid_bankruptcy_schema');
    const ready=b.status==='ready';
    if(ready) {
      const pct=b.total?Math.round(b.count/b.total*10000)/100:0;
      if(!Number.isInteger(b.count)||b.count<0||b.count>b.total||
         b.checked!==b.total||b.rows.length!==b.count||
         typeof b.percentage!=='number'||!Number.isFinite(b.percentage)||
         b.percentage!==pct)throw new DataUnavailable('invalid_bankruptcy_totals');
    }else if(b.count!==null||b.percentage!==null||b.rows.length!==0)
      throw new DataUnavailable('invalid_bankruptcy_unavailable');
    const rows=[],ordinals=new Set();
    let previousOrdinal=0;
    for(const [i,row] of b.rows.entries()) {
      if(!row||typeof row!=='object'||Array.isArray(row)||
         Object.keys(row).sort().join(',')!=='aidMasked,balance,nickname,ordinal,rank,setNet,thorNet'||
         row.rank!==i+1||
         !Number.isInteger(row.ordinal)||row.ordinal<1||row.ordinal>200||
         row.ordinal<=previousOrdinal||ordinals.has(row.ordinal)||
         typeof row.aidMasked!=='string'||!/^\*{2,16}\d{4}$/.test(row.aidMasked)||
         typeof row.nickname!=='string'||row.nickname.length<1||row.nickname.length>32||
         typeof row.balance!=='number'||!Number.isFinite(row.balance)||row.balance>0.2||row.balance< -1e12||
         typeof row.setNet!=='number'||!Number.isFinite(row.setNet)||Math.abs(row.setNet)>1e15||
         typeof row.thorNet!=='number'||!Number.isFinite(row.thorNet)||Math.abs(row.thorNet)>1e15)
        throw new DataUnavailable('invalid_bankruptcy_player');
      ordinals.add(row.ordinal);previousOrdinal=row.ordinal;
      rows.push({rank:row.rank,ordinal:row.ordinal,aidMasked:row.aidMasked,
        nickname:cleanNickname(row.nickname),balance:Math.min(0.2,Math.round(row.balance*10000)/10000),
        setNet:Math.round(row.setNet*100)/100,thorNet:Math.round(row.thorNet*100)/100});
    }
    bankruptcy={status:b.status,total:b.total,checked:b.checked,
      count:ready?b.count:null,percentage:ready?b.percentage:null,rows};
  }

  const eventEpoch=payload.eventEpoch,eventPhase=payload.eventPhase,eventStartTW=payload.eventStartTW,
        eventEndTW=payload.eventEndTW||'';
  if(!Number.isSafeInteger(eventEpoch) || eventEpoch<1 ||
     !['CCB','OFFICIAL'].includes(eventPhase)||
     typeof eventStartTW!=='string'||
     (eventPhase==='CCB'&&(eventStartTW!==''||eventEndTW!==''))||
     (eventPhase==='OFFICIAL'&&(!Number.isFinite(eventWindowMillis(eventStartTW))||
        !Number.isFinite(eventWindowMillis(eventEndTW))||
        eventWindowMillis(eventEndTW)<=eventWindowMillis(eventStartTW))))
    throw new DataUnavailable('invalid_event_snapshot');
  const unavailableModes = Array.isArray(payload.unavailableModes)
    ? payload.unavailableModes.filter(x=>x==='BET'||x==='MULT') : [];
  return {version:1,ok:true,status:eventPhase==='OFFICIAL'?'official_live':'testing',testMode:eventPhase!=='OFFICIAL',
    lastUpdated:new Date(timestamp).toISOString(),source:'local-whitelisted-b2b',
    refreshSeconds:60,eventEpoch,eventPhase,eventStartTW,eventEndTW,rankings,rtp,luckboard,bankruptcy,unavailableModes,
    note:eventPhase==='OFFICIAL'?'本榜單由白名單本機同步正式活動起始時間後的資料，實際派獎仍須核定。':'本榜單是 CCB 測試期間資料，非正式活動獎金或派獎結果。'};
}

/* Internal back-office records travel only over the authenticated B2B ingest
 * connection. They must NEVER appear in public rankings, local snapshot JSON
 * or the publicly archived JSON within Google Sheets. */
function validatePrivateAwardLedger(raw,publicSnapshot){
  if(!raw || typeof raw!=='object' || Array.isArray(raw) ||
     Object.keys(raw).sort().join(',')!=='eventEpoch,machineRows' ||
     raw.eventEpoch!==publicSnapshot.eventEpoch)
    throw new DataUnavailable('award_ledger_invalid');
  const machineRows=raw.machineRows;
  if(!machineRows || typeof machineRows!=='object' || Array.isArray(machineRows) ||
     Object.keys(machineRows).sort().join(',')!=='SET2,THOR')
    throw new DataUnavailable('award_ledger_machines_invalid');
  const output={eventEpoch:raw.eventEpoch,lastUpdated:publicSnapshot.lastUpdated,machineRows:{}};
  for(const code of MACHINE_CODES){
    const machine=machineRows[code];
    if(!machine || typeof machine!=='object' || Array.isArray(machine) ||
       Object.keys(machine).sort().join(',')!=='ACH,BET,MULT')
      throw new DataUnavailable('award_ledger_machine_invalid');
    const clean={};
    for(const kind of ['BET','MULT','ACH']){
      const rows=machine[kind];
      if(!Array.isArray(rows)||rows.length>(kind==='ACH'?200:10))
        throw new DataUnavailable('award_ledger_rows_invalid');
      const seen=new Set();
      clean[kind]=rows.map((row,i)=>{
        const fields=Object.keys(row||{}).sort().join(',');
        const expected=kind==='ACH'?'aid,bet,nickname':'aid,nickname,rank,score';
        if(!row||typeof row!=='object'||Array.isArray(row)||fields!==expected||
           typeof row.aid!=='string'||!/^\\d{6,20}$/.test(row.aid)||seen.has(row.aid)||
           typeof row.nickname!=='string'||row.nickname!==cleanNickname(row.nickname)||
           row.nickname.length<1||row.nickname.length>32)
          throw new DataUnavailable('award_ledger_player_invalid');
        seen.add(row.aid);
        if(kind==='ACH'){
          if(typeof row.bet!=='number'||!Number.isFinite(row.bet)||
             row.bet<80000||row.bet>1e15)
            throw new DataUnavailable('award_ledger_achievement_invalid');
          const publicPlayers=publicSnapshot.luckboard&&publicSnapshot.luckboard[code]||[];
          if(!publicPlayers.some(p=>p.nickname===row.nickname&&Math.abs(p.bet-row.bet)<0.011))
            throw new DataUnavailable('award_ledger_achievement_mismatch');
          return {aid:row.aid,nickname:row.nickname,bet:row.bet};
        }
        const publicRank=publicSnapshot.rankings[code][kind][i];
        if(!publicRank || row.rank!==publicRank.rank ||
           row.nickname!==publicRank.nickname ||
           typeof row.score!=='number'||!Number.isFinite(row.score)||
           Math.abs(row.score-publicRank.score)>0.00001)
          throw new DataUnavailable('award_ledger_ranking_mismatch');
        return {aid:row.aid,rank:row.rank,nickname:row.nickname,score:row.score};
      });
      if(kind!=='ACH'&&rows.length!==publicSnapshot.rankings[code][kind].length)
        throw new DataUnavailable('award_ledger_ranking_incomplete');
    }
    output.machineRows[code]=clean;
  }
  return output;
}

async function acceptLocalSnapshot(req,event) {
  const chunks=[];let len=0;
  for await(const chunk of req) {
    len+=chunk.length;if(len>400*1024)throw new DataUnavailable('payload_too_large');
    chunks.push(chunk);
  }
  let data;
  try {data=JSON.parse(Buffer.concat(chunks).toString('utf8'));}
  catch(_){throw new DataUnavailable('invalid_json');}
  const {awardLedger, ...publicData}=data;
  const valid=validatePublicSnapshot(publicData);
  if(!eventSnapshotMatches(valid,event))throw new DataUnavailable('event_epoch_or_phase_mismatch');
  // The CCB worker may briefly be an older version, but OFFICIAL must never
  // publish prizes without the matching back-office payout workbook update.
  if(event.phase==='OFFICIAL' && !awardLedger)
    throw new DataUnavailable('award_ledger_required');
  const ledger=awardLedger?validatePrivateAwardLedger(awardLedger,valid):null;
  if(event.phase==='OFFICIAL' && Date.now()>=eventWindowMillis(event.endTW))
    throw new DataUnavailable('event_finished');
  // Official rankings must be archived before publication. During CCB, use
  // best-effort durable storage so an older GAS deployment does not block QA.
  // If GAS cannot persist CCB yet, local cache still works until a Render restart.
  if(event.phase==='OFFICIAL'){
    try{await sheets.persistPublicSnapshot(valid,ledger)}
    catch{throw new DataUnavailable('backoffice_payout_sync_failed')}
  }else if(event.phase==='CCB'){
    try{await sheets.persistPublicSnapshot(valid,ledger)}
    catch{console.warn('CCB Sheet snapshot or payout sync pending; Apps Script deployment may need updating')}
  }
  fs.writeFileSync(SNAPSHOT_FILE,JSON.stringify(valid),'utf8');
  localSnapshot=valid;
  return {ok:true,lastUpdated:valid.lastUpdated,status:'test_snapshot_received'};
}
function getLocalSnapshot() {
  // Never silently delete a verified, epoch-bound snapshot solely because the
  // whitelisted computer stopped syncing. The API marks it stale instead.
  return localSnapshot;
}
async function restoreDurableSnapshot(event){
  // Archive is keyed by GAS's eventEpoch and stage; a past CCB can never be
  // surfaced in READY or a newly started OFFICIAL event.
  const saved=await sheets.readPublicSnapshot();
  if(!eventSnapshotMatches(saved,event))return null;
  localSnapshot=saved;
  return saved;
}
function isSnapshotStale(snapshot){
  const age=Date.now()-Date.parse(snapshot.lastUpdated);
  return !Number.isFinite(age)||age<0||age>MAX_SNAPSHOT_AGE_MS;
}
function viewSnapshot(snapshot,event){
  const stale=isSnapshotStale(snapshot);
  return {...snapshot,stale,status:stale?'local_sync_stale':snapshot.status,
    eventPhase:event.phase,
    note:stale?'保留最後一次成功同步的資料（已超過 15 分鐘，非即時）；等待白名單本機再次同步。':snapshot.note};
}


class DataUnavailable extends Error {
  constructor(code) { super(code); this.code = code; }
}
function config() {
  return {
    account: process.env.B2B_ACCOUNT || '',
    password: process.env.B2B_PASSWORD || '',
    session: process.env.B2B_SESSION_COOKIE || '',
    vendorId: process.env.B2B_VENDOR_ID || '',
    machine: { SET2: process.env.B2B_GAME_SET2 || '', THOR: process.env.B2B_GAME_THOR || '' },
    start: process.env.EVENT_START_TW || '',
    multiplierField: process.env.B2B_OFFICIAL_MULTIPLIER_FIELD || '',
    maxRows: Math.max(1,Math.min(50,Number(process.env.PUBLIC_RANK_LIMIT || 10)))
  };
}
function problems(c) {
  const errors=[];
  if(!c.account && !c.session) errors.push('backend_auth_not_configured');
  if(c.account && !c.password && !c.session) errors.push('backend_password_missing');
  if(!c.vendorId) errors.push('vendor_mapping_missing');
  if(!c.machine.SET2 || !c.machine.THOR) errors.push('machine_mapping_missing');
  if(!/^\d{4}[-/]\d\d[-/]\d\d \d\d:\d\d:\d\d$/.test(c.start)) errors.push('event_start_missing');
  return errors;
}
function taipeiNow() {
  const v=new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Taipei',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'}).format(new Date());
  return v.replaceAll('-','/');
}
function toB2BDate(value) { return String(value).replaceAll('-','/'); }
function cleanNickname(v) {
  const s=String(v||'').replace(/[\x00-\x1F\x7F]/g,'').trim();
  return (s || '匿名玩家').slice(0,MAX_NICKNAME);
}
function positiveNumber(v) {
  if(v == null || v === '') return null;
  const n=Number(String(v).replaceAll(',',''));
  return Number.isFinite(n) && n >= 0 ? n : null;
}
function collectCookie(h) {
  const all=(typeof h.getSetCookie==='function' ? h.getSetCookie():[h.get('set-cookie')]).filter(Boolean);
  // Backends may return multiple session cookies; never expose these.
  return all.map(s=>s.split(';')[0]).filter(Boolean).join('; ');
}
async function post(path,payload,c,retry=true) {
  if(!authCookie) {
    if(c.session) authCookie=c.session;
    else await login(c);
  }
  const headers={'Content-Type':'application/json','Accept':'application/json','Cookie':authCookie};
  let resp;
  try { resp=await fetch(new URL(path,API_BASE),{method:'POST',headers,body:JSON.stringify(payload||{}),signal:AbortSignal.timeout(18000),redirect:'error'}); }
  catch(e) { throw new DataUnavailable('backend_network_unavailable'); }
  const body=await resp.text();
  let json;try {json=JSON.parse(body);}catch(e){throw new DataUnavailable('backend_response_invalid');}
  if(resp.status===401 || json.status===401) {
    if(retry && !c.session){authCookie='';await login(c);return post(path,payload,c,false);}
    throw new DataUnavailable('backend_session_unauthorized');
  }
  if(!resp.ok || json.status!==2) throw new DataUnavailable('backend_read_failed');
  return json.data;
}
async function login(c) {
  if(!c.account || !c.password) throw new DataUnavailable('backend_auth_not_configured');
  let resp;
  try {resp=await fetch(new URL('login',API_BASE),{
    method:'POST',headers:{'Content-Type':'application/json'},
    body:JSON.stringify({account:c.account,password:c.password}),
    signal:AbortSignal.timeout(12000),redirect:'error'
  });}catch(e){
    // No credentials, cookies, URLs or request bodies in diagnostic logs.
    console.warn('B2B transport diagnostic',String(e?.cause?.code||e?.code||e?.name||'unknown').slice(0,50));
    throw new DataUnavailable('backend_login_network_error');
  }
  let body;try{body=await resp.json();}catch(e){throw new DataUnavailable('backend_login_invalid');}
  if(!resp.ok || body.status!=='success') throw new DataUnavailable('backend_login_rejected');
  authCookie=collectCookie(resp.headers);
  if(!authCookie) throw new DataUnavailable('backend_session_missing');
}
function normalizeBetRows(data,limit) {
  if(!Array.isArray(data)) throw new DataUnavailable('backend_player_schema_unknown');
  if(data.length && !data.every(r=>r && typeof r==='object' && ('validBet' in r || 'effective_bet' in r || 'effectiveBet' in r))) {
    throw new DataUnavailable('official_valid_bet_field_unverified');
  }
  const rows = data.map((r)=>({
    nickname:cleanNickname(r.nickname || r.playerName || r.name),
    score:positiveNumber(r.validBet ?? r.effective_bet ?? r.effectiveBet)
  })).filter(r=>r.score!==null && r.score>0);
  rows.sort((a,b)=>b.score-a.score || a.nickname.localeCompare(b.nickname,'zh-Hant'));
  return rows.slice(0,limit).map((r,i)=>({rank:i+1,nickname:r.nickname,score:r.score}));
}
async function fetchGame(c,code,stop) {
  const data=await post('gameSTMT/vendorGamePlayerSTMT',{
    advertiserId:null,vendorId:Number(c.vendorId),gameName:c.machine[code],
    start:toB2BDate(c.start),stop:stop
  },c);
  return normalizeBetRows(data,c.maxRows);
}
async function update() {
  const c=config(),missing=problems(c);
  if(missing.includes('backend_auth_not_configured') || missing.includes('backend_password_missing')) return {ok:false,status:'awaiting_configuration',issues:missing,rankings:{}};
  if(missing.includes('vendor_mapping_missing')){
    // Discover non-personal vendor metadata. Diagnostics stay in private Render logs.
    const data=await post('gameSTMT/vendorList',{},c);
    if(!Array.isArray(data))throw new DataUnavailable('backend_vendor_list_schema_unknown');
    const matched=data.filter(v=>v&&typeof v==='object' && /(^|[^a-z])sd([^a-z]|$)|賽特|雷神/i.test(String(v.description||'')+' '+String(v.name||'')));
    console.info('B2B vendor discovery',JSON.stringify({total:data.length,candidates:matched.slice(0,15).map(v=>({id:v.id,label:String(v.description||v.name||'').slice(0,90)}))}));
    return {ok:false,status:'awaiting_configuration',issues:missing,rankings:{}};
  }
  if(missing.length) return {ok:false,status:'awaiting_configuration',issues:missing,rankings:{}};
  const stop=taipeiNow();
  const entries=await Promise.all(MACHINE_CODES.map(async code=>[code,await fetchGame(c,code,stop)]));
  const rankings={};
  for(const [code,bet] of entries)rankings[code]={BET:bet,MULT:[]};
  return {ok:true,status:'provisional',lastUpdated:new Date().toISOString(),source:'B2B',refreshSeconds:60,rankings,
    unavailableModes:['MULT'],note:'僅為後台初步有效押碼排行，不代表正式派獎。倍率須確認官方逐局倍率欄位後開放。'};
}
async function data() {
  const local=getLocalSnapshot();
  if(local)return local;
  if((process.env.B2B_SYNC_TOKEN||'').length>=32) return {ok:false,status:'awaiting_local_sync',error:'waiting_for_whitelisted_computer',rankings:{}};
  if(cache && Date.now()-cache.at<REFRESH_MS)return cache.obj;
  if(!running) running=update().then(obj=>{cache={at:Date.now(),obj};return obj;}).catch(e=>{
    const obj={ok:false,status:'backend_unavailable',error:e instanceof DataUnavailable?e.code:'backend_unavailable',rankings:{}};
    cache={at:Date.now(),obj};return obj;
  }).finally(()=>{running=null});
  return running;
}
function send(res,status,obj,privateResponse=false) {
  res.writeHead(status,{'Content-Type':'application/json; charset=utf-8',
    'Cache-Control':privateResponse?'no-store':'public, max-age=15',
    'Access-Control-Allow-Origin':ORIGIN,
    'Access-Control-Allow-Methods':'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers':'Content-Type, Authorization',
    'X-Content-Type-Options':'nosniff'});
  res.end(JSON.stringify(obj));
}

/** Private short-lived registration verifier queue. An unverified AID cannot be written. */
const registrationJobs=new Map();
const REGISTRATION_TIMEOUT_MS=5*60_000;
const VERIFIER_ONLINE_MS=35_000;
let verifierLastSeen=0;
function verifierOnline(){return Date.now()-verifierLastSeen<VERIFIER_ONLINE_MS;}
function collectExpiredJobs(){
  const now=Date.now();
  for(const [id,job] of registrationJobs){
    if((job.state==='queued'||job.state==='verifying')&&now-job.startedAt>REGISTRATION_TIMEOUT_MS){
      job.state='timeout';job.name='';job.aid='';
    }
    if(now-job.startedAt>20*60_000)registrationJobs.delete(id);
  }
}
function timingKeyEqual(a,b){
  if(typeof a!=='string'||typeof b!=='string')return false;
  const x=Buffer.from(a),y=Buffer.from(b);
  return x.length===y.length&&crypto.timingSafeEqual(x,y);
}
function publicJobState(job){
  if(!job)return {ok:false,status:'unknown_request'};
  if(job.state==='registered')return {ok:true,status:'registered',registeredAt:job.registeredAt};
  if(job.state==='duplicate')return {ok:false,status:'already_registered'};
  if(job.state==='not_found')return {ok:false,status:'aid_not_found'};
  if(job.state==='verification_error')return {ok:false,status:'b2b_verification_unavailable'};
  if(job.state==='storage_error')return {ok:false,status:'sheet_storage_unavailable'};
  if(job.state==='timeout')return {ok:false,status:'verification_timeout'};
  return {ok:true,status:'verifying'};
}
async function initiateRegistration(input){
  collectExpiredJobs();
  if(!sheets.validateRegistration(input))return {http:400,body:{ok:false,error:'invalid_registration'}};
  const event=await sheets.eventStatus();
  if(!verifierOnline() || !await sheets.checkAccess() || !['CCB','OFFICIAL'].includes(event.phase))
    return {http:503,body:{ok:false,error:'registration_backend_not_ready'}};
  if([...registrationJobs.values()].filter(j=>j.state==='queued'||j.state==='verifying').length>=60)
    return {http:503,body:{ok:false,error:'registration_queue_full'}};
  const id=crypto.randomUUID(),key=crypto.randomBytes(32).toString('base64url');
  registrationJobs.set(id,{id,key,aid:String(input.aid).trim(),
    name:String(input.name).trim().normalize('NFC'),state:'queued',
    startedAt:Date.now(),sentAt:0,registeredAt:null,eventEpoch:event.epoch});
  return {http:202,body:{ok:true,status:'verifying',requestId:id,requestKey:key}};
}
async function registrationState(url){
  collectExpiredJobs();
  const j=registrationJobs.get(url.searchParams.get('requestId'));
  if(!j||!timingKeyEqual(j.key,url.searchParams.get('key')))
    return {http:404,body:{ok:false,status:'unknown_request'}};
  try{
    const current=await sheets.eventStatus();
    if(j.eventEpoch!==current.epoch)
      return {http:200,body:{ok:false,status:'verification_reset'}};
  }catch{return {http:503,body:{ok:false,status:'event_state_not_ready'}}}
  return {http:200,body:publicJobState(j)};
}
function popVerifyJobs(){
  verifierLastSeen=Date.now();
  collectExpiredJobs();
  const jobs=[];
  for(const job of registrationJobs.values()){
    if(job.state!=='queued'&&job.state!=='verifying')continue;
    if(job.sentAt&&Date.now()-job.sentAt<30000)continue;
    job.sentAt=Date.now();job.state='verifying';
    jobs.push({requestId:job.id,aid:job.aid});
    if(jobs.length>=10)break;
  }
  return jobs;
}
async function completeRegistration(input){
  if(!input||typeof input.requestId!=='string'||
     (typeof input.exists!=='boolean'&&input.error!==true))
    return {http:400,body:{ok:false,error:'invalid_verification_result'}};
  collectExpiredJobs();
  const job=registrationJobs.get(input.requestId);
  if(!job)return {http:404,body:{ok:false,error:'unknown_request'}};
  if(job.state!=='verifying')return {http:200,body:{ok:true,status:job.state}};
  if(input.error===true){
    job.state='verification_error';job.aid='';job.name='';
    return {http:200,body:{ok:true,status:'verification_error'}};
  }
  if(input.exists===false){
    job.state='not_found';job.aid='';job.name='';
    return {http:200,body:{ok:true,status:'not_found'}};
  }
  // The authorized Windows worker has verified an exact AID match in /player/list.
  // Script also checks phase under its registration lock to prevent reset races.
  let phase,epoch;
  try{const event=await sheets.eventStatus();phase=event.phase;epoch=event.epoch}catch{return {http:503,body:{ok:false,error:'event_status_unavailable'}}}
  if(!['CCB','OFFICIAL'].includes(phase) || epoch!==job.eventEpoch){
    job.state='timeout';job.aid='';job.name='';
    return {http:409,body:{ok:false,error:'event_paused'}};
  }
  job.state='writing';
  try{
    const result=await sheets.register({aid:job.aid,name:job.name,consent:true});
    if(result.status===201 && result.result?.ok===true && result.result.status==='pending_review'){
      job.state='registered';job.registeredAt=result.result.registeredAt;
      job.aid='';job.name='';
      return {http:200,body:{ok:true,status:'registered'}};
    }
    if(result.status===409){
      job.state='duplicate';job.aid='';job.name='';
      return {http:200,body:{ok:true,status:'duplicate'}};
    }
    throw new Error('sheets_registration_not_confirmed');
  }catch(err){
    console.warn('Verified registration could not be saved (sensitive values hidden)');
    job.state='storage_error';job.aid='';job.name='';
    return {http:503,body:{ok:false,error:'registration_storage_unavailable'}};
  }
}

const registerLimits=new Map();
function rateLimit(req){
  const raw=String(req.headers['x-forwarded-for']||req.socket.remoteAddress||'unknown');
  const key=raw.split(',')[0].trim().slice(0,120),now=Date.now();
  for(const [k,v] of registerLimits){if(now-v.since>60*60_000)registerLimits.delete(k)}
  const item=registerLimits.get(key)||{since:now,n:0};
  if(now-item.since>60*60_000){item.since=now;item.n=0;}
  item.n++;registerLimits.set(key,item);return item.n<=5;
}
async function parseRegistrationBody(req){
  if(!String(req.headers['content-type']||'').startsWith('application/json'))throw Error('invalid_content_type');
  let bytes=0;const chunks=[];
  for await(const chunk of req){bytes+=chunk.length;if(bytes>4096)throw Error('payload_too_large');chunks.push(chunk);}
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}
const server=http.createServer(async(req,res)=>{
  const url=new URL(req.url||'/', 'http://localhost');
  if(req.method==='OPTIONS'){
    if(req.headers.origin!==ORIGIN)return send(res,403,{ok:false,error:'origin_not_allowed'},true);
    return send(res,204,{},true);
  }
  if(url.pathname==='/api/event/status'&&req.method==='GET'){
    try{
      const event=await sheets.eventStatus();
      return send(res,200,{ok:true,event},true);
    }catch{return send(res,503,{ok:false,status:'event_state_not_ready'},true)}
  }
  if(url.pathname.startsWith('/api/admin/event/')){
    if(!adminAuthorized(req.headers.authorization))return send(res,401,{ok:false,error:'admin_unauthorized'},true);
    if(req.headers.origin && req.headers.origin!==ORIGIN)return send(res,403,{ok:false,error:'origin_not_allowed'},true);
    try{
      if(url.pathname==='/api/admin/event/status'&&req.method==='GET'){
        const event=await sheets.eventStatus();
        return send(res,200,{ok:true,event,snapshotAvailable:eventSnapshotMatches(getLocalSnapshot(),event)},true);
      }
      if(url.pathname==='/api/admin/event/clear-ccb'&&req.method==='POST'){
        const payload=await parseRegistrationBody(req);
        if(!payload||payload.confirm!=='清空CCB資料'||Object.keys(payload).length!==1)
          return send(res,400,{ok:false,error:'reset_confirmation_required'},true);
        const result=await sheets.clearCcb();
        clearTransientEventData();
        return send(res,200,{ok:true,cleared:result.cleared,event:result.event,publicRankingsCleared:true},true);
      }
      if(url.pathname==='/api/admin/event/start-official'&&req.method==='POST'){
        const payload=await parseRegistrationBody(req);
        if(!payload||payload.confirm!=='啟動正式活動'||
           Object.keys(payload).sort().join(',')!=='confirm,endTW,startTW')
          return send(res,400,{ok:false,error:'official_confirmation_required'},true);
        const start=eventWindowMillis(payload.startTW),end=eventWindowMillis(payload.endTW);
        if(!Number.isFinite(start)||!Number.isFinite(end)||
           start<Date.now()-30000||start>Date.now()+365*86400000||
           end<=start||end-start>45*86400000)
          return send(res,400,{ok:false,error:'invalid_event_dates'},true);
        const result=await sheets.startOfficial(payload.startTW,payload.endTW);
        clearTransientEventData();
        return send(res,200,{ok:true,event:result.event,publicRankingsCleared:true},true);
      }
      return send(res,405,{ok:false,error:'method_not_allowed'},true);
    }catch(err){
      console.warn('Admin event transition failed (no personal data logged)');
      return send(res,503,{ok:false,error:'event_transition_not_confirmed'},true);
    }
  }
  if(url.pathname==='/api/registration/status'&&req.method==='GET'){
    try{
      const [sheetReady,event]=await Promise.all([sheets.checkAccess(),sheets.eventStatus()]);
      const workerReady=verifierOnline();
      const phaseReady=['CCB','OFFICIAL'].includes(event.phase);
      return send(res,200,{ok:true,enabled:sheetReady&&workerReady&&phaseReady,
        sheetReady,verifierOnline:workerReady,phase:event.phase,
        message:!phaseReady?'event_paused':sheetReady&&workerReady?'ready':'awaiting_google_sheets_or_whitelisted_verifier'},true);
    }catch{return send(res,200,{ok:true,enabled:false,sheetReady:false,verifierOnline:verifierOnline(),phase:'UNKNOWN',message:'event_state_not_ready'},true)}
  }
  if(url.pathname==='/api/registration/result'&&req.method==='GET'){
    const status=await registrationState(url);
    return send(res,status.http,status.body,true);
  }
  if((url.pathname==='/api/registration'||url.pathname==='/api/registration/start')&&req.method==='POST'){
    if(req.headers.origin!==ORIGIN)return send(res,403,{ok:false,error:'origin_not_allowed'},true);
    if(!rateLimit(req))return send(res,429,{ok:false,error:'too_many_attempts'},true);
    let input;try{input=await parseRegistrationBody(req);}catch{return send(res,400,{ok:false,error:'invalid_payload'},true);}
    try{const result=await initiateRegistration(input);return send(res,result.http,result.body,true);}
    catch(err){return send(res,503,{ok:false,error:'registration_backend_unavailable'},true);}
  }
  if(url.pathname==='/api/verifier/jobs'&&req.method==='GET'){
    if(!protectedTokenMatches(req.headers.authorization))return send(res,401,{ok:false,error:'unauthorized'},true);
    try{
      const event=await sheets.eventStatus();
      return send(res,200,{ok:true,jobs:['CCB','OFFICIAL'].includes(event.phase)?popVerifyJobs():[],event:{phase:event.phase,epoch:event.epoch}},true);
    }catch{return send(res,503,{ok:false,error:'event_state_not_ready'},true)}
  }
  if(url.pathname==='/api/verifier/aids'&&req.method==='GET'){
    if(!protectedTokenMatches(req.headers.authorization))return send(res,401,{ok:false,error:'unauthorized'},true);
    try{
      const result=await sheets.listAidsWithEvent();
      return send(res,200,{ok:true,aids:result.aids,event:result.event,eventCode:'DUAL2026'},true);
    }
    catch(err){return send(res,503,{ok:false,error:'registration_list_unavailable'},true);}
  }
  if(url.pathname==='/api/verifier/result'&&req.method==='POST'){
    if(!protectedTokenMatches(req.headers.authorization))return send(res,401,{ok:false,error:'unauthorized'},true);
    let input;try{input=await parseRegistrationBody(req);}catch{return send(res,400,{ok:false,error:'invalid_payload'},true);}
    const response=await completeRegistration(input);
    return send(res,response.http,response.body,true);
  }
  if(url.pathname==='/api/ingest') {
    if(req.method!=='POST')return send(res,405,{ok:false,error:'method_not_allowed'});
    if(!protectedTokenMatches(req.headers.authorization))return send(res,401,{ok:false,error:'unauthorized'});
    try{
      const event=await sheets.eventStatus();
      if(!['CCB','OFFICIAL'].includes(event.phase))
        return send(res,409,{ok:false,error:'event_paused'},true);
      return send(res,200,await acceptLocalSnapshot(req,event));
    }
    catch(e){return send(res,400,{ok:false,error:e instanceof DataUnavailable?e.code:'invalid_snapshot'});}
  }
  if(req.method!=='GET')return send(res,405,{ok:false,error:'method_not_allowed'});
  if(url.pathname==='/health')return send(res,200,{ok:true,service:'sdx-leaderboard-gateway',configured:!problems(config()).length,localSyncEnabled:(process.env.B2B_SYNC_TOKEN||'').length>=32});
  if(url.pathname==='/api/rankings'){
    try{
      const event=await sheets.eventStatus();
      if(event.phase==='READY')return send(res,200,{ok:false,status:'event_paused',
        eventPhase:event.phase,eventEpoch:event.epoch,rankings:{},rtp:null,luckboard:null},true);
      if(event.phase==='SCHEDULED')
        return send(res,200,{ok:false,status:'event_scheduled',eventPhase:'SCHEDULED',
          startTW:event.startTW,endTW:event.endTW,rankings:{},rtp:null,luckboard:null},true);
      if(event.phase==='ENDED'){
        const saved=await sheets.readPublicSnapshot();
        if(completedSnapshotMatches(saved,event))
          return send(res,200,{...saved,status:'event_ended',eventPhase:'ENDED',
            finalized:true,testMode:false,refreshSeconds:0,note:'本次活動已結束，榜單保留最後一次有效同步的資料；不再更新或接受新登記。'},true);
        return send(res,200,{ok:false,status:'event_ended_no_snapshot',eventPhase:'ENDED',
          startTW:event.startTW,endTW:event.endTW,rankings:{},rtp:null,luckboard:null},true);
      }
      let current=await data();
      if(!eventSnapshotMatches(current,event)){
        try{current=await restoreDurableSnapshot(event)}
        catch{current=null}
      }
      if(!eventSnapshotMatches(current,event))
        return send(res,200,{ok:false,status:'awaiting_local_sync',
          eventPhase:event.phase,eventEpoch:event.epoch,rankings:{},rtp:null,luckboard:null},true);
      return send(res,200,viewSnapshot(current,event),true);
    }catch{return send(res,200,{ok:false,status:'event_state_not_ready',rankings:{},rtp:null,luckboard:null},true);}
  }
  return send(res,404,{ok:false,error:'not_found'});
});
if(require.main===module)server.listen(PORT,'0.0.0.0',()=>console.log('SDX leaderboard gateway listening'));
module.exports={server,config,problems,normalizeBetRows,cleanNickname,positiveNumber,validatePublicSnapshot,protectedTokenMatches,getLocalSnapshot,adminAuthorized,eventSnapshotMatches,completedSnapshotMatches,eventWindowMillis,isSnapshotStale,viewSnapshot,validatePrivateAwardLedger,clearTransientEventData};
