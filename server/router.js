const json=(value,status=200)=>Response.json(value,{status,headers:{'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});
const readObject=async(env,key)=>{const o=await env.BUCKET.get(key);return o?o.json():null;};
const writeObject=(env,key,value)=>env.BUCKET.put(key,JSON.stringify(value),{httpMetadata:{contentType:'application/json'}});
const dataHeaders={'Content-Type':'application/json;charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'};
const writeJsonText=(env,key,text)=>env.BUCKET.put(key,text,{httpMetadata:{contentType:'application/json'}});
const timestamp=value=>typeof value==='string'&&/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(value)&&Number.isFinite(Date.parse(value))&&new Date(value.slice(0,10)+'T00:00:00Z').toISOString().slice(0,10)===value.slice(0,10)?Date.parse(value):NaN;
const authenticatedEmail=request=>(request.headers.get('oai-authenticated-user-email')||'').trim().toLowerCase();
const ownerMatch=(request,env)=>{const email=authenticatedEmail(request),owner=typeof env.OWNER_EMAIL==='string'?env.OWNER_EMAIL.trim().toLowerCase():'';return !!email&&!!owner&&email===owner;};
const crossSite=request=>(request.headers.get('Sec-Fetch-Site')||'').toLowerCase()==='cross-site';
const canWrite=(request,env)=>!authenticatedEmail(request)||ownerMatch(request,env);
// Private Sites authenticates visitors and service callers before this Worker.
export default {async fetch(request,env){
 const u=new URL(request.url),method=request.method;
 const competitorLogoMatch=/^\/competitor-logos\/(fcc-v2|o8-v2|aos-v2|cgb-v2|cgb-v3|goldfun-v2|o9-v2)\.webp$/.exec(u.pathname);
 if(competitorLogoMatch&&typeof COMPETITOR_LOGOS!=='undefined'&&Object.hasOwn(COMPETITOR_LOGOS,competitorLogoMatch[1])){
  if(!['GET','HEAD'].includes(method))return json({error:'Method not allowed'},405);
  return new Response(method==='HEAD'?null:Uint8Array.from(atob(COMPETITOR_LOGOS[competitorLogoMatch[1]]),c=>c.charCodeAt(0)),{headers:{'Content-Type':'image/webp','Cache-Control':'public,max-age=31536000,immutable','X-Content-Type-Options':'nosniff'}});
 }
 const brandMatch=/^\/brand-logos\/(win|qz|song|rd|lucky|bo)-v2\.webp$/.exec(u.pathname);
 if(brandMatch&&typeof BRAND_LOGOS!=='undefined'&&Object.hasOwn(BRAND_LOGOS,brandMatch[1])){
  if(!['GET','HEAD'].includes(method))return json({error:'Method not allowed'},405);
  return new Response(method==='HEAD'?null:Uint8Array.from(atob(BRAND_LOGOS[brandMatch[1]]),c=>c.charCodeAt(0)),{headers:{'Content-Type':'image/webp','Cache-Control':'public,max-age=31536000,immutable','X-Content-Type-Options':'nosniff'}});
 }
 if(u.pathname==='/font.woff2')return new Response(Uint8Array.from(atob(FONT),c=>c.charCodeAt(0)),{headers:{'Content-Type':'font/woff2','Cache-Control':'public,max-age=31536000,immutable'}});
 if(u.pathname==='/background.webp')return new Response(Uint8Array.from(atob(BG),c=>c.charCodeAt(0)),{headers:{'Content-Type':'image/webp','Cache-Control':'public,max-age=31536000,immutable'}});
 if(u.pathname==='/ink-background-v1.webp'&&(method==='GET'||method==='HEAD'))return new Response(method==='HEAD'?null:Uint8Array.from(atob(INK_BG),c=>c.charCodeAt(0)),{headers:{'Content-Type':'image/webp','Cache-Control':'public,max-age=31536000,immutable'}});
 if(method!=='GET'&&(!canWrite(request,env)||crossSite(request)))return json({error:'Forbidden'},403);
 if(u.pathname==='/api/access'){
  if(method!=='GET')return json({error:'Method not allowed'},405);
  const canRefresh=ownerMatch(request,env)&&!crossSite(request);
  return json({canRefresh,readOnly:!canRefresh});
 }
 if(u.pathname==='/api/data'){
  if(method==='GET'){
   const object=env.BUCKET?await env.BUCKET.get('dashboard/latest.json'):null;
   return new Response(object?.body??INITIAL_JSON,{headers:dataHeaders});
  }
  if(method!=='PUT')return json({error:'Method not allowed'},405);
  const text=await request.text();if(text.length>15000000)return json({error:'Too large'},413);
  let d;try{d=JSON.parse(text)}catch{return json({error:'Invalid JSON'},400)}
  if(d?.schema!==1||!Array.isArray(d.platforms)||d.platforms.length!==6||!Array.isArray(d.monthly)||!Number.isFinite(timestamp(d.generatedAt)))return json({error:'Invalid schema'},400);
  if(!env.BUCKET)return json({error:'Storage unavailable'},503);
  const prior=await readObject(env,'dashboard/meta.json'),storedTime=timestamp(prior?.generatedAt),baseline=Number.isFinite(storedTime)?storedTime:timestamp(INITIAL_GENERATED_AT),staleBaseline=Number.isFinite(storedTime)?'stored-meta':'initial-build';
  // Older deployments may not have meta yet: their explicit migration baseline
  // is the build timestamp, without parsing the large latest.json object.
  const result=(value,status=200)=>{const response=json(value,status);response.headers.set('X-Dashboard-Stale-Baseline',staleBaseline);return response;};
  if(timestamp(d.generatedAt)<baseline)return result({error:'Stale update rejected',staleBaseline},409);
  await writeJsonText(env,'dashboard/latest.json',text);await writeJsonText(env,'dashboard/history/'+d.generatedAt.slice(0,10)+'.json',text);
  await writeObject(env,'dashboard/meta.json',{schema:1,generatedAt:d.generatedAt,months:d.monthly.length});
  return result({ok:true,generatedAt:d.generatedAt,months:d.monthly.length,staleBaseline});
 }
 if(u.pathname==='/api/refresh'){
  const old=await readObject(env,'refresh/latest.json');
  if(method==='GET')return json(old||{state:'idle'});
  if(method==='POST'){
   if(old&&['queued','running'].includes(old.state)&&Date.now()-Date.parse(old.updatedAt||old.createdAt)<20*60000)return json(old);
   const stamp=new Date().toISOString(),job={id:crypto.randomUUID(),state:'queued',createdAt:stamp,updatedAt:stamp,summary:'已提出刷新要求，等待本機收集程式。'};await writeObject(env,'refresh/latest.json',job);return json(job,202);
  }
  if(method==='PATCH'){
   let body;try{const text=await request.text();if(text.length>65536)return json({error:'Too large'},413);body=JSON.parse(text);}catch{return json({error:'Invalid JSON'},400)}
   if(!old||old.id!==body.id)return json({error:'Refresh request changed'},409);
   if(!['running','succeeded','partial','failed'].includes(body.state))return json({error:'Invalid state'},400);
   const allowed={state:body.state,summary:String(body.summary||'').slice(0,1500),updatedAt:new Date().toISOString()};
   if(Array.isArray(body.platforms))allowed.platforms=body.platforms.map(p=>({key:String(p.key),state:String(p.state),through:p.through||null,error:p.error?String(p.error).slice(0,500):null}));
   if(['succeeded','partial','failed'].includes(body.state))allowed.finishedAt=new Date().toISOString();
   const next={...old,...allowed};await writeObject(env,'refresh/latest.json',next);return json(next);
  }
  return json({error:'Method not allowed'},405);
 }
 if(u.pathname==='/api/health')return json({ok:true,storage:!!env.BUCKET});
 if(u.pathname==='/favicon.ico')return new Response(null,{status:204});
 if(u.pathname!=='/')return new Response('Not found',{status:404});
 return new Response(PAGE,{headers:{'Content-Type':'text/html;charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Content-Security-Policy':"default-src 'self';script-src 'self' 'unsafe-inline';style-src 'self' 'unsafe-inline';font-src 'self';img-src 'self' data:;connect-src 'self';frame-ancestors 'self' https://chatgpt.com https://*.chatgpt.com;base-uri 'none';form-action 'self'"}});
}};
