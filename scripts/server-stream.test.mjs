import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import {webcrypto} from 'node:crypto';

const router=await fs.readFile(new URL('../server/router.js',import.meta.url),'utf8');
const INITIAL=' {"schema":1,"generatedAt":"2000-01-10T00:00:00.000Z","example":"empty fallback"} ';
const payload=(generatedAt='2000-01-12T00:00:00.000Z')=>({schema:1,platforms:Array.from({length:6},(_,i)=>({key:'demo'+i})),monthly:[],generatedAt});
function harness(objects={},options={}){
 const gets=[],puts=[],jsonReads=[],stats={parses:0,datasetStringifies:0};
 const bucket={async get(key){gets.push(key);if(options.get)return options.get(key);const value=objects[key];return value===undefined?null:{async json(){jsonReads.push(key);return value;}};},async put(key,body,metadata){puts.push({key,body,metadata});}};
 const context=vm.createContext({Response,Request,Headers,URL,ReadableStream,TextEncoder,atob,crypto:webcrypto,INITIAL_JSON:INITIAL,INITIAL_GENERATED_AT:'2000-01-10T00:00:00.000Z',FONT:'',BG:'',PAGE:'<html>example</html>',JSON:{parse(text){stats.parses++;return JSON.parse(text);},stringify(value){if(value?.platforms){stats.datasetStringifies++;throw Error('Dataset must not be reserialized');}return JSON.stringify(value);}}});
 vm.runInContext(router.replace('export default','globalThis.handler='),context);
 const env=options.noBucket?{}:{BUCKET:bucket,...options.env};
 return{gets,puts,jsonReads,stats,env,async fetch(method='GET',body=null,headers={},route='/api/data'){const request={url:'https://example.invalid'+route,method,headers:new Headers(headers),async text(){return body??'';}};return context.handler.fetch(request,env);}};
}

test('GET streams the R2 body without parsing, JSON reading or reserializing the dataset',async()=>{
 const text=' {"example":"streamed 原值"} ',bytes=new TextEncoder().encode(text);let jsonCalls=0,pulls=0;
 const stream=new ReadableStream({pull(controller){pulls++;controller.enqueue(bytes);controller.close();}}),h=harness({}, {get:key=>{assert.equal(key,'dashboard/latest.json');return{body:stream,async json(){jsonCalls++;throw Error('must not parse');},async text(){throw Error('must not buffer');}};}});
 const response=await h.fetch();assert.equal(response.status,200);assert.equal(await response.text(),text);assert.equal(jsonCalls,0);assert.equal(h.stats.parses,0);assert.equal(h.stats.datasetStringifies,0);assert.equal(pulls,1);assert.equal(response.headers.get('cache-control'),'no-store');assert.equal(response.headers.get('x-content-type-options'),'nosniff');assert.match(response.headers.get('content-type'),/application\/json/);
});
test('missing R2 or missing latest object returns the pre-serialized INITIAL_JSON unchanged',async()=>{
 for(const options of [{noBucket:true},{}]){const h=harness({},options),r=await h.fetch();assert.equal(await r.text(),INITIAL);assert.equal(h.stats.parses,0);assert.equal(h.stats.datasetStringifies,0);assert.equal(r.headers.get('cache-control'),'no-store');}
});
test('PUT reads only small meta, parses once, reuses the original text twice and then writes metadata',async()=>{
 const h=harness({'dashboard/meta.json':{generatedAt:'2000-01-11T00:00:00.000Z'}}),text='\n  '+JSON.stringify(payload())+'\n';const r=await h.fetch('PUT',text);
 assert.equal(r.status,200);assert.deepEqual(h.gets,['dashboard/meta.json']);assert.deepEqual(h.jsonReads,['dashboard/meta.json']);assert.equal(h.stats.parses,1);assert.equal(h.stats.datasetStringifies,0);
 assert.deepEqual(h.puts.map(p=>p.key),['dashboard/latest.json','dashboard/history/2000-01-12.json','dashboard/meta.json']);assert.equal(h.puts[0].body,text);assert.equal(h.puts[1].body,text);assert.equal(h.puts[0].metadata.httpMetadata.contentType,'application/json');assert.deepEqual(JSON.parse(h.puts[2].body),{schema:1,generatedAt:'2000-01-12T00:00:00.000Z',months:0});assert.equal(r.headers.get('x-dashboard-stale-baseline'),'stored-meta');assert.equal((await r.json()).staleBaseline,'stored-meta');
});
test('stale dates reject using stored metadata; missing or invalid metadata declares the initial-build baseline',async()=>{
 let h=harness({'dashboard/meta.json':{generatedAt:'2000-01-13T00:00:00.000Z'}}),r=await h.fetch('PUT',JSON.stringify(payload()));assert.equal(r.status,409);assert.equal(h.puts.length,0);assert.equal(r.headers.get('x-dashboard-stale-baseline'),'stored-meta');
 for(const meta of [undefined,{generatedAt:'not-a-date'}]){h=harness(meta?{'dashboard/meta.json':meta}:{});r=await h.fetch('PUT',JSON.stringify(payload('2000-01-09T00:00:00.000Z')));assert.equal(r.status,409);assert.equal((await r.json()).staleBaseline,'initial-build');assert.equal(h.puts.length,0);assert.deepEqual(h.gets,['dashboard/meta.json']);}
 h=harness();r=await h.fetch('PUT',JSON.stringify(payload('2000-01-10T00:00:00.000Z')));assert.equal(r.status,200);assert.equal(r.headers.get('x-dashboard-stale-baseline'),'initial-build');assert.equal(h.puts.length,3);
});
test('timestamp comparison uses actual instants across timezone offsets',async()=>{
 const h=harness({'dashboard/meta.json':{generatedAt:'2000-01-12T10:00:00Z'}}),r=await h.fetch('PUT',JSON.stringify(payload('2000-01-12T17:00:00+08:00')));assert.equal(r.status,409);assert.equal(h.puts.length,0);
});
test('invalid schema, invalid calendar dates, oversized data and unavailable storage remain rejected',async()=>{
 const invalid=['{broken','null',JSON.stringify({...payload(),schema:2}),JSON.stringify({...payload(),platforms:[]}),JSON.stringify({...payload(),monthly:null}),...['bad','2000-99-01T00:00:00Z','2000-02-31T00:00:00Z',null,{}].map(generatedAt=>JSON.stringify(payload(generatedAt)))];
 for(const text of invalid){const h=harness(),r=await h.fetch('PUT',text);assert.equal(r.status,400,text);assert.equal(h.puts.length,0);assert.equal(h.gets.length,0);}
 let h=harness(),r=await h.fetch('PUT',' '.repeat(15000001));assert.equal(r.status,413);assert.equal(h.stats.parses,0);assert.equal(h.puts.length,0);
 h=harness({}, {noBucket:true});r=await h.fetch('PUT',JSON.stringify(payload()));assert.equal(r.status,503);
});
test('owner and cross-site protections still reject before reads and writes; unsupported data methods remain 405',async()=>{
 for(const headers of [{'oai-authenticated-user-email':'other@example.invalid'},{'oai-authenticated-user-email':'owner@example.invalid','Sec-Fetch-Site':'cross-site'}]){const h=harness({}, {env:{OWNER_EMAIL:'owner@example.invalid'}}),r=await h.fetch('PUT',JSON.stringify(payload()),headers);assert.equal(r.status,403);assert.equal(h.gets.length,0);assert.equal(h.puts.length,0);assert.equal(h.stats.parses,0);}
 const h=harness(),r=await h.fetch('POST',JSON.stringify(payload()));assert.equal(r.status,405);assert.equal(h.puts.length,0);
});
test('refresh route retains its separate small-object queue and patch behavior',async()=>{
 const old={id:'existing-job',state:'queued',createdAt:new Date().toISOString(),updatedAt:new Date().toISOString()},h=harness({'refresh/latest.json':old});let r=await h.fetch('POST',null,{},'/api/refresh');assert.equal(r.status,200);assert.equal((await r.json()).id,old.id);assert.equal(h.puts.length,0);
 r=await h.fetch('PATCH',JSON.stringify({id:old.id,state:'succeeded',summary:'done'}),{},'/api/refresh');assert.equal(r.status,200);assert.equal(h.puts[0].key,'refresh/latest.json');assert.equal(JSON.parse(h.puts[0].body).state,'succeeded');
});
test('build source emits serialized initial text and timestamp, without building or deploying',async()=>{
 const build=await fs.readFile(new URL('./build.mjs',import.meta.url),'utf8');assert.match(build,/const INITIAL_JSON=/);assert.match(build,/const INITIAL_GENERATED_AT=/);assert.doesNotMatch(build,/const INITIAL=\$\{JSON\.stringify\(data\)\}/);
});
