import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import {createPreviewHandler} from './preview.mjs';
const keys=['fcc','o8','aos','cgb','goldfun','o9'];
const version=key=>key==='cgb'?'v3':'v2';
const assetNames=[...keys.map(key=>key+'-'+version(key)),'cgb-v2'];

test('six known competitor logos and Chinese aliases use fixed versioned asset paths',async()=>{
 const scope=vm.createContext({});vm.runInContext(await fs.readFile(new URL('../app/brand-logos.js',import.meta.url),'utf8'),scope);
 for(const [key,name]of [['fcc','財哥'],['o8','發又發'],['aos','黑桃A'],['cgb','超吉爆'],['cgb','超級爆'],['goldfun','金來快'],['o9','黑狗兄'],['goldfun','goldfun88'],['o9','o9play']]){scope.input=name;const html=vm.runInContext('brandLogo(input,{size:44,decorative:true})',scope);assert.match(html,new RegExp('/competitor-logos/'+key+'-'+version(key)+'\\.webp'));assert.match(html,/--brand-logo-size:44px/);assert.match(html,/aria-hidden="true"/);}
 scope.input='<script>not-a-brand</script>';assert.equal(vm.runInContext('brandLogo(input)',scope),'');scope.input='win';assert.match(vm.runInContext('brandLogo(input)',scope),/\/brand-logos\/win-v2\.webp/);
});
test('fixed competitor asset router preserves every version byte, HEAD and method restrictions',async()=>{
 const assets=Object.fromEntries(await Promise.all(assetNames.map(async asset=>[asset,await fs.readFile(new URL('../assets/competitor-logos/'+asset+'.webp',import.meta.url))]))),scope={Response,Request,URL,crypto,Date,PAGE:'page',INITIAL_JSON:'{}',INITIAL_GENERATED_AT:'2026-10-21T00:00:00Z',FONT:'',BG:'',atob,COMPETITOR_LOGOS:Object.fromEntries(assetNames.map(asset=>[asset,assets[asset].toString('base64')]))};
 vm.createContext(scope);vm.runInContext((await fs.readFile(new URL('../server/router.js',import.meta.url),'utf8')).replace('export default','globalThis.worker='),scope);
 for(const asset of assetNames){const url='https://dashboard.test/competitor-logos/'+asset+'.webp',response=await scope.worker.fetch(new Request(url),{});assert.equal(response.status,200);assert.equal(response.headers.get('content-type'),'image/webp');assert.match(response.headers.get('cache-control'),/immutable/);assert.deepEqual(Buffer.from(await response.arrayBuffer()),assets[asset]);assert.equal((await(await scope.worker.fetch(new Request(url,{method:'HEAD'}),{})).arrayBuffer()).byteLength,0);assert.equal((await scope.worker.fetch(new Request(url,{method:'POST'}),{})).status,405);}
 assert.notDeepEqual(assets['cgb-v2'],assets['cgb-v3'],'new coin-paw artwork must not overwrite the immutable old version');
 for(const asset of ['unknown-v2','goldfun-v3','o9-v3','cgb-v4'])assert.equal((await scope.worker.fetch(new Request('https://dashboard.test/competitor-logos/'+asset+'.webp'),{})).status,404);
});
test('local preview resolves all six current logos and legacy CGB without a Site credential',async()=>{
 for(const asset of assetNames){let target,status,body;const handler=createPreviewHandler({projectRoot:'X:/fixture',getToken:async()=>{throw Error('asset_must_not_decrypt');},readFile:async file=>{target=file;return Buffer.from('fixture-webp');}}),req={url:'/competitor-logos/'+asset+'.webp',method:'GET',headers:{host:'127.0.0.1:4178'}},res={writeHead(code){status=code;},end(value){body=value;}};await handler(req,res);assert.equal(status,200);assert.match(target.replaceAll('\\','/'),new RegExp('assets/competitor-logos/'+asset+'\\.webp$'));assert.equal(body.toString(),'fixture-webp');}
});
test('build packaging uses the same fixed versioned keys as the asset routes',async()=>{
 const build=await fs.readFile(new URL('./build.mjs',import.meta.url),'utf8'),match=/const competitorLogos=.*?Promise\.all\((\[[^\]]+\])\.map/s.exec(build);assert.ok(match);const packaged=[...match[1].matchAll(/'([^']+)'/g)].map(m=>m[1]);assert.deepEqual(packaged.sort(),[...assetNames].sort());for(const asset of packaged){const bytes=await fs.readFile(new URL('../assets/competitor-logos/'+asset+'.webp',import.meta.url));assert.equal(bytes.toString('ascii',0,4),'RIFF');assert.equal(bytes.toString('ascii',8,12),'WEBP');}
});
