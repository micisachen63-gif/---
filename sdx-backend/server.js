'use strict';
/**
 * SD x 贏麻了 / read-only B2B leaderboard gateway.
 * No credentials, AIDs, raw tickets or real names are sent to the browser.
 */
const http = require('node:http');
const { URL } = require('node:url');

const PORT = Number(process.env.PORT || 3000);
const ORIGIN = 'https://sdx-winmalo-internal-event-2026.onrender.com';
const API_BASE = 'https://admin-b2b.winmalo.com:9032/api/';
const REFRESH_MS = 60_000;
const MAX_NICKNAME = 32;
const MACHINE_CODES = ['SET2', 'THOR'];
let authCookie = '';
let cache = null;
let running = null;

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
  });}catch(e){throw new DataUnavailable('backend_login_network_error');}
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
  if(missing.length) return {ok:false,status:'awaiting_configuration',issues:missing,rankings:{}};
  const stop=taipeiNow();
  const entries=await Promise.all(MACHINE_CODES.map(async code=>[code,await fetchGame(c,code,stop)]));
  const rankings={};
  for(const [code,bet] of entries)rankings[code]={BET:bet,MULT:[]};
  return {ok:true,status:'provisional',lastUpdated:new Date().toISOString(),source:'B2B',refreshSeconds:60,rankings,
    unavailableModes:['MULT'],note:'僅為後台初步有效押碼排行，不代表正式派獎。倍率須確認官方逐局倍率欄位後開放。'};
}
async function data() {
  if(cache && Date.now()-cache.at<REFRESH_MS)return cache.obj;
  if(!running) running=update().then(obj=>{cache={at:Date.now(),obj};return obj;}).catch(e=>{
    const obj={ok:false,status:'backend_unavailable',error:e instanceof DataUnavailable?e.code:'backend_unavailable',rankings:{}};
    cache={at:Date.now(),obj};return obj;
  }).finally(()=>{running=null});
  return running;
}
function send(res,status,obj) {
  res.writeHead(status,{'Content-Type':'application/json; charset=utf-8',
    'Cache-Control':'public, max-age=15',
    'Access-Control-Allow-Origin':ORIGIN,
    'Access-Control-Allow-Methods':'GET, OPTIONS',
    'Access-Control-Allow-Headers':'Content-Type',
    'X-Content-Type-Options':'nosniff'});
  res.end(JSON.stringify(obj));
}
const server=http.createServer(async(req,res)=>{
  const url=new URL(req.url||'/', 'http://localhost');
  if(req.method==='OPTIONS')return send(res,204,{});
  if(req.method!=='GET')return send(res,405,{ok:false,error:'method_not_allowed'});
  if(url.pathname==='/health')return send(res,200,{ok:true,service:'sdx-leaderboard-gateway',configured:!problems(config()).length});
  if(url.pathname==='/api/rankings')return send(res,200,await data());
  return send(res,404,{ok:false,error:'not_found'});
});
if(require.main===module)server.listen(PORT,'0.0.0.0',()=>console.log('SDX leaderboard gateway listening'));
module.exports={server,config,problems,normalizeBetRows,cleanNickname,positiveNumber};
