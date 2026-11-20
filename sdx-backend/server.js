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
  const unavailableModes = Array.isArray(payload.unavailableModes)
    ? payload.unavailableModes.filter(x=>x==='BET'||x==='MULT') : [];
  return {version:1,ok:true,status:'testing',testMode:true,
    lastUpdated:new Date(timestamp).toISOString(),source:'local-whitelisted-b2b',
    refreshSeconds:60,rankings,unavailableModes,
    note:'本榜單顯示由白名單本機同步之測試資料，未完成官方結算或正式派獎審核。'};
}
async function acceptLocalSnapshot(req) {
  const chunks=[];let len=0;
  for await(const chunk of req) {
    len+=chunk.length;if(len>128*1024)throw new DataUnavailable('payload_too_large');
    chunks.push(chunk);
  }
  let data;
  try {data=JSON.parse(Buffer.concat(chunks).toString('utf8'));}
  catch(_){throw new DataUnavailable('invalid_json');}
  const valid=validatePublicSnapshot(data);
  fs.writeFileSync(SNAPSHOT_FILE,JSON.stringify(valid),'utf8');
  localSnapshot=valid;
  return {ok:true,lastUpdated:valid.lastUpdated,status:'test_snapshot_received'};
}
function getLocalSnapshot() {
  if (!localSnapshot) return null;
  const age=Date.now()-Date.parse(localSnapshot.lastUpdated);
  if(age<0 || age>MAX_SNAPSHOT_AGE_MS)
    return {ok:false,status:'local_sync_stale',lastUpdated:localSnapshot.lastUpdated,
      error:'local_sync_stale',rankings:{}};
  return localSnapshot;
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
    'Access-Control-Allow-Headers':'Content-Type',
    'X-Content-Type-Options':'nosniff'});
  res.end(JSON.stringify(obj));
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
  if(url.pathname==='/api/registration/status'&&req.method==='GET')
    return send(res,200,{ok:true,enabled:!!sheets.credentials(),message:sheets.credentials()?'ready':'awaiting_secure_google_authorization'},true);
  if(url.pathname==='/api/registration'&&req.method==='POST'){
    if(req.headers.origin!==ORIGIN)return send(res,403,{ok:false,error:'origin_not_allowed'},true);
    if(!rateLimit(req))return send(res,429,{ok:false,error:'too_many_attempts'},true);
    let input;try{input=await parseRegistrationBody(req);}catch{return send(res,400,{ok:false,error:'invalid_payload'},true);}
    try{const result=await sheets.register(input);return send(res,result.status,result.result,true);}
    catch(error){console.warn('Sheets registration failed',String(error.message||'unknown').slice(0,80));return send(res,503,{ok:false,error:'registration_storage_unavailable'},true);}
  }
  if(url.pathname==='/api/ingest') {
    if(req.method!=='POST')return send(res,405,{ok:false,error:'method_not_allowed'});
    if(!protectedTokenMatches(req.headers.authorization))return send(res,401,{ok:false,error:'unauthorized'});
    try {return send(res,200,await acceptLocalSnapshot(req));}
    catch(e){return send(res,400,{ok:false,error:e instanceof DataUnavailable?e.code:'invalid_snapshot'});}
  }
  if(req.method!=='GET')return send(res,405,{ok:false,error:'method_not_allowed'});
  if(url.pathname==='/health')return send(res,200,{ok:true,service:'sdx-leaderboard-gateway',configured:!problems(config()).length,localSyncEnabled:(process.env.B2B_SYNC_TOKEN||'').length>=32});
  if(url.pathname==='/api/rankings')return send(res,200,await data());
  return send(res,404,{ok:false,error:'not_found'});
});
if(require.main===module)server.listen(PORT,'0.0.0.0',()=>console.log('SDX leaderboard gateway listening'));
module.exports={server,config,problems,normalizeBetRows,cleanNickname,positiveNumber,validatePublicSnapshot,protectedTokenMatches,getLocalSnapshot};
