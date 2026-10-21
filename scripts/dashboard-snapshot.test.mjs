import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {gunzipSync} from 'node:zlib';
import {prepareDashboardSnapshot,gzipDashboardBytes} from './dashboard-snapshot.mjs';

async function fixture(t) {
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'dashboard-snapshot-'));
 t.after(()=>fs.rm(root,{recursive:true,force:true}));
 await fs.mkdir(path.join(root,'data'));
 return {root,json:path.join(root,'data/dashboard.json'),gzip:path.join(root,'data/dashboard-snapshot.json.gz')};
}

const original=Buffer.from(' {\r\n "schema":1,"zero":0,"missingVsNull":null,"unknown":{"aid":"00001","__proto__":{"safe":true}},"label":"繁體中文","rows":[{},null,0,false] }\r\n\t','utf8');

test('snapshot retains exact full JSON bytes and every unknown/null/zero value deterministically',async t=>{
 const f=await fixture(t);await fs.writeFile(f.json,original);
 const first=await prepareDashboardSnapshot(f.root),snapshot=await fs.readFile(f.gzip);
 assert.equal(first.source,'json');assert.deepEqual(first.bytes,original);
 assert.deepEqual(first.data,JSON.parse(original.toString('utf8')));
 assert.deepEqual(await fs.readFile(f.json),original);
 assert.deepEqual(gunzipSync(snapshot),original);
 await prepareDashboardSnapshot(f.root);
 assert.deepEqual(await fs.readFile(f.gzip),snapshot);
 assert.deepEqual(gzipDashboardBytes(original),snapshot);
 assert.equal(snapshot.readUInt32LE(4),0,'gzip contains no build timestamp');
});

test('fresh clone containing only gzip materializes the identical original full JSON',async t=>{
 const f=await fixture(t);await fs.writeFile(f.gzip,gzipDashboardBytes(original));
 const result=await prepareDashboardSnapshot(f.root);
 assert.equal(result.source,'gzip');assert.deepEqual(result.bytes,original);
 assert.deepEqual(await fs.readFile(f.json),original);
 assert.deepEqual(result.data,JSON.parse(original.toString('utf8')));
});

test('existing full JSON takes precedence over an older snapshot',async t=>{
 const f=await fixture(t);await fs.writeFile(f.gzip,gzipDashboardBytes(Buffer.from('{"old":true}')));
 await fs.writeFile(f.json,original);const result=await prepareDashboardSnapshot(f.root);
 assert.equal(result.source,'json');assert.deepEqual(gunzipSync(await fs.readFile(f.gzip)),original);
});

test('corrupt existing full JSON rejects without fallback or changing either source',async t=>{
 const f=await fixture(t),snapshot=gzipDashboardBytes(original),broken=Buffer.from('{"broken":');
 await fs.writeFile(f.gzip,snapshot);await fs.writeFile(f.json,broken);
 await assert.rejects(prepareDashboardSnapshot(f.root),SyntaxError);
 assert.deepEqual(await fs.readFile(f.json),broken);assert.deepEqual(await fs.readFile(f.gzip),snapshot);
});

test('corrupt or invalid-JSON gzip rejects without creating a full JSON file',async t=>{
 const f=await fixture(t);
 for(const bytes of [Buffer.from('not gzip'),gzipDashboardBytes(Buffer.from('{broken')),gzipDashboardBytes(Buffer.from('null')),gzipDashboardBytes(Buffer.from('{"bad":"\ufffd"}').subarray(0,9))]) {
  await fs.writeFile(f.gzip,bytes);await assert.rejects(prepareDashboardSnapshot(f.root));
  await assert.rejects(fs.readFile(f.json),{code:'ENOENT'});
 }
});
