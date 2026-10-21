import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {root} from './collect-data.mjs';
import {decryptToken} from './standalone-refresh.mjs';
import {SITE_URL} from './refresh.mjs';

const ASSETS={
 '/competitor-logos/fcc-v2.webp':['assets/competitor-logos/fcc-v2.webp','image/webp'],
 '/competitor-logos/o8-v2.webp':['assets/competitor-logos/o8-v2.webp','image/webp'],
 '/competitor-logos/aos-v2.webp':['assets/competitor-logos/aos-v2.webp','image/webp'],
 '/competitor-logos/cgb-v2.webp':['assets/competitor-logos/cgb-v2.webp','image/webp'],
 '/competitor-logos/cgb-v3.webp':['assets/competitor-logos/cgb-v3.webp','image/webp'],
 '/competitor-logos/goldfun-v2.webp':['assets/competitor-logos/goldfun-v2.webp','image/webp'],
 '/competitor-logos/o9-v2.webp':['assets/competitor-logos/o9-v2.webp','image/webp'],
 '/brand-logos/win-v2.webp':['assets/brand-logos/win-v2.webp','image/webp'],
 '/brand-logos/qz-v2.webp':['assets/brand-logos/qz-v2.webp','image/webp'],
 '/brand-logos/song-v2.webp':['assets/brand-logos/song-v2.webp','image/webp'],
 '/brand-logos/rd-v2.webp':['assets/brand-logos/rd-v2.webp','image/webp'],
 '/brand-logos/lucky-v2.webp':['assets/brand-logos/lucky-v2.webp','image/webp'],
 '/brand-logos/bo-v2.webp':['assets/brand-logos/bo-v2.webp','image/webp'],
 '/mobile-preview':['data/mobile-preview.html','text/html; charset=utf-8'],
 '/':['data/preview.html','text/html; charset=utf-8'],
 '/index.html':['data/preview.html','text/html; charset=utf-8'],
 '/api/data':['data/dashboard.json','application/json; charset=utf-8'],
 '/background.webp':['assets/dashboard-bg-v2.webp','image/webp'],
 '/ink-background-v1.webp':['assets/ink-background-v1.webp','image/webp'],
 '/font.woff2':['assets/noto-sans-tc.woff2','font/woff2'],
 '/font':['assets/noto-sans-tc.woff2','font/woff2']
};
function json(res,status,body){res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(JSON.stringify(body));}
export function localRequestAllowed(req,port=4178){
 const hosts=new Set(['127.0.0.1:'+port,'localhost:'+port]);
 if(!hosts.has(req.headers.host))return false;
 if(req.headers['sec-fetch-site']==='cross-site')return false;
 const origin=req.headers.origin;
 if(origin&&!['http://127.0.0.1:'+port,'http://localhost:'+port].includes(origin))return false;
 // Only same-origin browser writes may enqueue a real production refresh.
 if(req.method==='POST'&&!origin)return false;
 return true;
}
async function requestBody(req){let bytes=0,body='';for await(const chunk of req){bytes+=Buffer.byteLength(chunk);if(bytes>8192)throw Error('Body too large');body+=chunk;}if(!body.trim())return {};const value=JSON.parse(body);if(!value||Array.isArray(value)||typeof value!=='object')throw Error('Invalid request');return value;}
export function createPreviewHandler({port=4178,readFile=fs.readFile,getToken=decryptToken,fetcher=fetch,projectRoot=root}={}){
 return async(req,res)=>{
  if(!localRequestAllowed(req,port)){json(res,403,{ok:false,error:'Local preview origin rejected'});return;}
  const pathname=new URL(req.url,'http://127.0.0.1:'+port).pathname;
  try{
   if(pathname==='/api/refresh'){
    if(!['GET','POST'].includes(req.method)){json(res,405,{ok:false,error:'Method not allowed'});return;}
    const input=req.method==='POST'?await requestBody(req):null;
    let token=await getToken();
    try{
     const upstream=await fetcher(SITE_URL+'/api/refresh',{method:req.method,redirect:'manual',headers:{'OAI-Sites-Authorization':'Bearer '+token,'Content-Type':'application/json'},...(input?{body:JSON.stringify(input)}:{}),signal:AbortSignal.timeout(30000)});
     // Never redirect a caller or forward Site cookies, access headers, or HTML.
     if(!upstream.ok){json(res,upstream.status>=400&&upstream.status<600?upstream.status:502,{ok:false,error:'Private refresh service unavailable',upstreamStatus:upstream.status});return;}
     const text=await upstream.text();if(text.length>1024*1024)throw Error('Unexpected upstream response');
     json(res,upstream.status,JSON.parse(text));return;
    }finally{token=undefined;}
   }
   const asset=ASSETS[pathname];if(!asset){json(res,404,{ok:false,error:'Not found'});return;}
   if(!['GET','HEAD'].includes(req.method)){json(res,405,{ok:false,error:'Method not allowed'});return;}
   const body=await readFile(path.join(projectRoot,asset[0]));
   res.writeHead(200,{'Content-Type':asset[1],'Content-Length':body.length,'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(req.method==='HEAD'?undefined:body);
  }catch(error){json(res,error instanceof SyntaxError?400:502,{ok:false,error:error instanceof SyntaxError?'Invalid JSON request':'Preview or private refresh service unavailable'});}
 };
}
export function startPreview(port=4178){return http.createServer(createPreviewHandler({port})).listen(port,'127.0.0.1',()=>console.log('Local: http://127.0.0.1:'+port));}
if(process.argv[1]===fileURLToPath(import.meta.url))startPreview();
