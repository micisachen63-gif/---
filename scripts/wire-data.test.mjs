import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import {createHash,webcrypto} from 'node:crypto';
import {encodeDashboardPayload} from './wire-data.mjs';
import {encodeDashboardTransport} from './transport-data.mjs';
import {publishData} from './refresh.mjs';

const decoderSource=await fs.readFile(new URL('../app/data-wire.js',import.meta.url),'utf8');
const context=vm.createContext({DecompressionStream,Blob,crypto:webcrypto,atob,TextDecoder,Uint8Array});vm.runInContext(decoderSource,context);
const decode=value=>context.decodeDashboardPayload(value);
const json=value=>JSON.parse(JSON.stringify(value));
const bytes=value=>Buffer.byteLength(JSON.stringify(value));
test('latest real dashboard roundtrips every field including raw captures and source metadata',async t=>{
 const data=JSON.parse(await fs.readFile(new URL('../data/dashboard.json',import.meta.url),'utf8')),before=JSON.stringify(data),wire=encodeDashboardPayload(data),transport=json(wire),decoded=decode(transport);
 assert.deepEqual(json(decoded),json(data));assert.equal(JSON.stringify(data),before,'encoding must not mutate the local dashboard');
 assert.equal(JSON.stringify(transport),JSON.stringify(wire),'decoding must not mutate the wire payload');
 const allowedEncoding=value=>value==='column-dictionary-v1'||wire.archiveWire?.version===1&&value==='column-dictionary-archive-v1'||[2,3].includes(wire.archiveWire?.version)&&value==='column-dictionary-details-v1'||wire.archiveWire?.version===3&&value==='column-dictionary-channels-v1';
 assert(Array.isArray(wire.machines.rowFields));assert(allowedEncoding(wire.machines.rows.encoding));assert(wire.cohorts.every(c=>c.rowFields&&allowedEncoding(c.rows.encoding)));assert(wire.payments.months.every(m=>m.payerFields&&allowedEncoding(m.payers.encoding)));
 assert.equal(decoded.machines.rows[0].reportedRtpRaw,data.machines.rows[0].reportedRtpRaw);assert.deepEqual(json(decoded.machines.rows[0].raw),data.machines.rows[0].raw);assert.equal(decoded.machines.rows[0].sourceRow,data.machines.rows[0].sourceRow);
 assert(bytes(wire)<bytes(data)*.8,'columnar transport should materially reduce the real payload');
 assert(JSON.stringify(encodeDashboardTransport(data)).length<=15000000,'current complete dataset must stay within the fixed Worker request.text().length cap; UTF-8 bytes are diagnostic, not that limit');
 t.diagnostic(JSON.stringify({objectBytes:bytes(data),wireChars:JSON.stringify(wire).length,wireBytes:bytes(wire),savedBytes:bytes(data)-bytes(wire),cohortRows:data.cohorts.reduce((s,c)=>s+c.rows.length,0),machineRows:data.machines.rows.length,payerRows:data.payments.months.reduce((s,m)=>s+m.payers.length,0)}));
});

// Frozen v1 validation/decoding contract, retained to test rollout safety.
// New wrappers must fail here before any numeric cell can become an AID/cash.
function legacyV1Decoder(payload){
 const object=v=>v!==null&&typeof v==='object'&&!Array.isArray(v),targets=[];
 if(!object(payload))throw TypeError('dashboard payload must be an object');
 const add=(table,rows,fields,missing)=>{if(!object(table))throw TypeError('invalid table');if(Object.hasOwn(table,fields)||Object.hasOwn(table,missing))targets.push({table,rows,fields,missing});else if(Object.hasOwn(table,rows)&&table[rows]!==null&&(!Array.isArray(table[rows])||table[rows].some(r=>!object(r))))throw TypeError('invalid legacy rows');};
 const visit=d=>{d.cohorts?.forEach(c=>add(c,'rows','rowFields','rowMissing'));if(d.machines)add(d.machines,'rows','rowFields','rowMissing');d.payments?.months?.forEach(m=>add(m,'payers','payerFields','payerMissing'));};
 visit(payload);if(!targets.length)return payload;const data=json(payload);targets.length=0;visit(data);
 for(const {table,rows,fields,missing} of targets){const names=table[fields],values=table[rows];if(!Array.isArray(names)||names.some(k=>typeof k!=='string')||new Set(names).size!==names.length)throw TypeError('invalid fields');if(!Array.isArray(values)||values.some(r=>!Array.isArray(r)||r.length!==names.length))throw TypeError('invalid wire row width');const masks=new Map((table[missing]??[]).map(([row,...cols])=>[row,new Set(cols)]));table[rows]=values.map((r,index)=>Object.fromEntries(names.flatMap((key,i)=>masks.get(index)?.has(i)?[]:[[key,r[i]]])));delete table[fields];delete table[missing];}
 return data;
}

test('rollout rejects new dictionary rows in the old decoder; new decoder reads v1 and original objects',()=>{
 const original={cohorts:[{rows:[{aid:'000001',cash:300,name:'repeat'},{aid:'000002',cash:400,name:'repeat'}]}],machines:{rows:[]}};
 const oldWire={cohorts:[{rows:[['000001',300,'repeat'],['000002',400,'repeat']],rowFields:['aid','cash','name']}],machines:{rows:[],rowFields:[]}};
 assert.deepEqual(json(decode(oldWire)),original);assert.deepEqual(legacyV1Decoder(oldWire),original);assert.throws(()=>legacyV1Decoder(json(encodeDashboardPayload(original))),TypeError);const raw=json(original);assert.equal(decode(raw),raw);
 const onlyMerchants={merchantCandidates:{groups:[{candidates:[{aid:'000001',cash:300}]}]}};assert.deepEqual(legacyV1Decoder(encodeDashboardPayload(onlyMerchants)),onlyMerchants,'without a v1 validation guard table, merchant-only data remains legacy objects');
});

test('repeated strings, nested objects and complete merchant candidate blocks compress without aliasing decoded cells',()=>{
 const nested=JSON.parse('{"__proto__":{"safe":true},"constructor":{"items":[1,null,"字典"]}}'),rows=Array.from({length:100},(_,i)=>({aid:'account-'+i,label:'same long descriptive label repeated in each row',nested,jsonValue:i%2?{payload:['one long repetitive value',null]}:{payload:['another long repetitive value',0]}}));
 const original={machines:{rows},merchantCandidates:{groups:[{platform:'demo',candidates:rows,accounts:rows,confirmedMerchants:rows}],candidates:rows,confirmedMerchants:rows},unrelated:{keep:'untouched'}},before=JSON.stringify(original),wire=encodeDashboardPayload(original),transport=json(wire),decoded=decode(transport);
 assert.equal(JSON.stringify(original),before);assert.deepEqual(json(decoded),json(original));assert.equal(wire.merchantCandidates.groups[0].accounts.encoding,'column-dictionary-v1');assert.equal(wire.merchantCandidates.groups[0].candidates.encoding,'column-dictionary-v1');assert.equal(wire.merchantCandidates.confirmedMerchants.encoding,'column-dictionary-v1');
 assert(wire.machines.rows.columns.some(c=>Object.hasOwn(c,'constant')));assert(wire.machines.rows.columns.some(c=>Object.hasOwn(c,'dictionary')));assert(bytes(wire)<bytes(original)*.4);
 decoded.machines.rows[0].nested.constructor.items.push('mutation');assert.equal(decoded.machines.rows[1].nested.constructor.items.length,3);assert.equal(decoded.merchantCandidates.groups[0].accounts[0].nested.constructor.items.length,3);assert.equal(original.machines.rows[0].nested.constructor.items.length,3);assert.equal({}.safe,undefined);assert(Object.hasOwn(decoded.machines.rows[0].nested,'__proto__'));assert.equal(JSON.stringify(transport),JSON.stringify(wire));
 decoded.machines.rows[0].jsonValue.payload[0]='changed';assert.notEqual(decoded.machines.rows[2].jsonValue.payload[0],'changed');
});

test('malformed dictionary wrappers, lengths, indexes and ambiguous columns fail explicitly',()=>{
 const base={machines:{rows:{encoding:'column-dictionary-v1',length:2,columns:[{dictionary:[{value:'a'},{value:'b'}],indexes:[0,1]}]},rowFields:['nested']}};
 const edits=[d=>d.machines.rows.encoding='future-unrecognized',d=>d.machines.rows.length=-1,d=>d.machines.rows.length=1.5,d=>d.machines.rows.columns=[],d=>d.machines.rows.columns[0].indexes=[0],d=>d.machines.rows.columns[0].indexes=[0,2],d=>d.machines.rows.columns[0].indexes=[0,.5],d=>d.machines.rows.columns[0].dictionary=[],d=>d.machines.rows.columns[0].values=[1,2],d=>d.machines.rows.columns=[{values:[1]}],d=>d.machines.rows.columns=[{}],d=>d.machines.rowMissing=[[0,0]]];
 for(const edit of edits){const d=json(base);edit(d);assert.throws(()=>decode(d),{name:'TypeError'});}
 assert.deepEqual(json(decode(base)).machines.rows,[{nested:{value:'a'}},{nested:{value:'b'}}]);
});
test('empty, missing, null and undefined retain JSON semantics without creating fields',()=>{
 const original={schema:1,cohorts:[{rows:[]},{rows:[{a:null,b:undefined},{c:3},{a:undefined}]},{rows:null},{metadata:1}],machines:{rows:[{}, {raw:[undefined,null],zero:0,no:false,empty:''}]},payments:{months:[{payers:[]},{payers:[{aid:'001',name:null,cash:0},{aid:'002',cash:100,unknown:undefined}]}]},other:undefined};
 const wire=encodeDashboardPayload(original),decoded=decode(json(wire));
 assert.deepEqual(json(decoded),json(original));assert.deepEqual(wire.cohorts[1].rowFields,['a','c']);assert.deepEqual(wire.cohorts[1].rowMissing,[[0,1],[1,0],[2,0,1]]);
 assert(Object.hasOwn(decoded.cohorts[1].rows[0],'a'));assert(!Object.hasOwn(decoded.cohorts[1].rows[1],'a'));assert(!Object.hasOwn(decoded,'other'));assert.deepEqual(json(decoded.machines.rows[1].raw),[null,null]);
 const old=json(original);assert.equal(decode(old),old,'legacy object format is usable unchanged');
});
test('all unknown future row fields, nested raw values and unusual JSON property names survive',()=>{
 const row=JSON.parse('{"aid":"00001","__proto__":{"polluted":true},"constructor":"value","cash":-0.25,"future":{"values":[1,null,"中"]}}');
 const original={cohorts:[{rows:[row,{aid:'00002',future:null}]}],machines:{rows:[{machineId:null,vendor:'廠',sourceRow:2,raw:['廠','原幣','0.01'],newField:{x:1}}]},payments:{months:[{payers:[row]}]},unrelated:{retained:true}};
 const decoded=decode(json(encodeDashboardPayload(original)));assert.deepEqual(json(decoded),original);assert(Object.hasOwn(decoded.cohorts[0].rows[0],'__proto__'));assert.equal({}.polluted,undefined);
 decoded.machines.rows[0].raw[0]='changed';assert.equal(original.machines.rows[0].raw[0],'廠');
});
test('malformed columns and missing masks are rejected rather than misaligning financial values',()=>{
 const base={cohorts:[{rows:[[1,null]],rowFields:['cash','name'],rowMissing:[[0,1]]}]};
 const edits=[x=>x.cohorts[0].rowFields=['cash','cash'],x=>x.cohorts[0].rowFields=['cash',null],x=>x.cohorts[0].rows=[[1]],x=>x.cohorts[0].rows=[{cash:1}],x=>x.cohorts[0].rowMissing=[[1,1]],x=>x.cohorts[0].rowMissing=[[0,1,1]],x=>x.cohorts[0].rowMissing=[[0,1],[0,1]],x=>x.cohorts[0].rowMissing=[[0,0]],x=>delete x.cohorts[0].rowFields,x=>x.cohorts[0].rowMissing='bad',x=>x.cohorts[0].rows=null];
 for(const edit of edits){const corrupt=json(base);edit(corrupt);assert.throws(()=>decode(corrupt),{name:'TypeError'})}
 assert.throws(()=>encodeDashboardPayload({machines:{rows:[[1,2]]}}),TypeError);assert.throws(()=>encodeDashboardPayload({cohorts:[{rows:[null]}]}),TypeError);assert.throws(()=>encodeDashboardPayload(base),TypeError);
 assert.throws(()=>decode({machines:{rows:[[1,2]]}}),{name:'TypeError'});assert.throws(()=>decode({payments:{months:[{payers:[[1,2]],payerFields:['cash']}]}}),{name:'TypeError'});
});
test('refresh publishes and verifies the actual wire bytes while preserving the caller dataset',async()=>{
 const data={schema:1,generatedAt:'2026-10-20T09:00:00Z',platforms:['win','qz','song','rd','lucky','bo'].map(key=>({key})),monthly:[],cohorts:[{platform:'win',rows:[{aid:'001',cash:100,name:'甲'},{aid:'002',cash:0}]}],machines:{rows:[{machineId:null,bets:10,payouts:20,raw:['original']}]},payments:{months:[{payers:[{aid:'001',name:'甲',cash:100}]}]}},before=JSON.stringify(data);
 let text;const receipt=await publishData(data,'memory-only-test-token',async(url,options)=>{if(options.method==='PUT'){text=options.body;assert.equal(JSON.parse(text).archiveWire.version,4);assert.equal(JSON.parse(text).transport.encoding,'gzip-base64');return Response.json({ok:true,generatedAt:data.generatedAt})}return new Response(text)});
 assert.equal(receipt.sha256,createHash('sha256').update(text).digest('hex'));assert.equal(receipt.bytes,Buffer.byteLength(text));assert.equal(JSON.stringify(data),before);assert.deepEqual(json(await context.decodeDashboardTransport(JSON.parse(text))),data);
 await assert.rejects(publishData(data,'memory-only-test-token',async(url,options)=>options.method==='PUT'?Response.json({ok:true,generatedAt:data.generatedAt}):new Response(before)),/讀回內容/,'an object-format echo cannot count as exact wire verification');
});

function archiveFixture(platform='o8'){
 const source=JSON.parse('{"file":"one-private-source.json","capturedAt":"2026-10-21T01:00:00Z","queryProof":{"verified":true},"__proto__":{"safe":true}}');
 const daily=Array.from({length:30},(_,i)=>({date:'2026-01-'+String(i+1).padStart(2,'0'),buyCoins:i%2?0:null,source,nested:{items:['same',null]},...(i%2?{}:{unknown:undefined})}));
 return{platform,daily,monthly:[{month:'2026-01',complete:false,buyCoins:null}],history:{daily,monthly:[],operatingDaily:daily,operatingMonthly:[],registrationMonths:[],sources:[source],operatingSources:[]}};
}
// Frozen dictionary-v1 wrapper validation used before archive support existed.
// It must reject the guard even though it would not otherwise visit archive tables.
function previousDictionaryValidation(payload){
 const tables=[...(payload.cohorts??[]).map(c=>[c,'rows']),...(payload.machines?[[payload.machines,'rows']]:[]),...(payload.payments?.months??[]).map(m=>[m,'payers'])];
 for(const [table,key]of tables){const encoded=table[key];if(encoded&&!Array.isArray(encoded)&&encoded.encoding!=='column-dictionary-v1')throw TypeError('invalid dictionary wrapper');}
 return payload;
}
test('archive table dictionaries and o8 alias deduplicate losslessly; previous dictionary decoder explicitly rejects marker',()=>{
 const own=archiveFixture(),original={cohorts:[{rows:[{aid:'001',cash:0}]}],competitorArchives:{schema:1,platforms:[own,archiveFixture('aos')]},competitorArchive:own},before=JSON.stringify(original),wire=encodeDashboardPayload(original),decoded=decode(json(wire));
 assert.equal(wire.archiveWire.version,1);assert.equal(wire.archiveWire.aliases.competitorArchive,'o8');assert(!Object.hasOwn(wire,'competitorArchive'));assert.equal(wire.cohorts[0].rows.encoding,'column-dictionary-archive-v1');assert.equal(wire.competitorArchives.platforms[0].daily.encoding,'column-dictionary-v1');assert.throws(()=>previousDictionaryValidation(wire),TypeError);
 assert.deepEqual(json(decoded),json(original));assert.equal(JSON.stringify(original),before);assert(bytes(wire)<bytes(original)*.6);assert(!Object.hasOwn(decoded,'archiveWire'));
 decoded.competitorArchives.platforms[0].daily[0].source.queryProof.verified=false;assert.equal(decoded.competitorArchives.platforms[0].daily[1].source.queryProof.verified,true);assert.equal(decoded.competitorArchive.daily[0].source.queryProof.verified,true);assert.equal(original.competitorArchive.daily[0].source.queryProof.verified,true);
 decoded.competitorArchive.daily[0].nested.items.push('mutation');assert.equal(decoded.competitorArchive.daily[1].nested.items.length,2);assert(Object.hasOwn(decoded.competitorArchive.daily[0].source,'__proto__'));assert.equal({}.safe,undefined);
});
test('archive-only guard preserves originally missing, null, or metadata-only machine objects exactly',()=>{
 for(const original of [{competitorArchive:archiveFixture()},{machines:null,competitorArchive:archiveFixture()},{machines:{metadata:'keep'},competitorArchive:archiveFixture()}]){const wire=encodeDashboardPayload(original);assert.equal(wire.machines.rows.encoding,'column-dictionary-archive-v1');assert.throws(()=>previousDictionaryValidation(wire),TypeError);assert.deepEqual(json(decode(json(wire))),json(original));}
 const original={competitorArchives:{schema:1,platforms:[archiveFixture()]}},wire=encodeDashboardPayload(original);assert.deepEqual(json(decode(json(wire))),json(original));assert.equal(wire.archiveWire.aliases.competitorArchive,undefined);
});
test('archive alias differing from aggregate stays separate; legacy object and old dictionaries remain readable',()=>{
 const original={competitorArchive:archiveFixture(),competitorArchives:{platforms:[{...archiveFixture(),extra:'different'}]}},wire=encodeDashboardPayload(original);assert(Object.hasOwn(wire,'competitorArchive'));assert.deepEqual(json(decode(json(wire))),json(original));
 const raw=json(original);assert.equal(decode(raw),raw);const old={machines:{rows:{encoding:'column-dictionary-v1',length:1,columns:[{constant:0}]},rowFields:['bets']},competitorArchive:archiveFixture()};assert.equal(decode(old).machines.rows[0].bets,0);assert.equal(decode(old).competitorArchive.daily[0].buyCoins,null);
});
test('unknown archive version, corrupt alias, missing guard and malformed archive table fail explicitly',()=>{
 const own=archiveFixture(),base=encodeDashboardPayload({competitorArchive:own,competitorArchives:{platforms:[own]}});
 for(const edit of [d=>{d.archiveWire.version=99;},d=>{d.archiveWire.aliases.competitorArchive='aos';},d=>{d.competitorArchives.platforms=[];},d=>{d.competitorArchives.platforms[0].daily.length=-1;},d=>{delete d.archiveWire;},d=>{d.archiveWire.syntheticMachineGuard={hadOwn:true};}]){const d=json(base);edit(d);assert.throws(()=>decode(d),{name:'TypeError'});}
 assert.throws(()=>decode({archiveWire:{format:'operations-archive-columns',version:1,aliases:{}}}),{name:'TypeError'});assert.throws(()=>encodeDashboardPayload({archiveWire:{businessField:true}}),TypeError);
});

// Version 1's shipped archive decoder rejects this marker before inspecting data.
const previousArchiveVersionValidation=value=>{if(value.archiveWire&&(value.archiveWire.format!=='operations-archive-columns'||value.archiveWire.version!==1))throw TypeError('unsupported archive wire version or alias');return previousDictionaryValidation(value);};
function detailFixture(){return{machines:{rows:[{machineName:'main',bets:0}],comparisonRows:Array.from({length:300},(_,i)=>JSON.parse('{"machineName":"comparison","vendor":"example","bets":0,"payouts":null,"source":{"file":"example.json","notes":["repeat"]},"__proto__":{"safe":true},"index":'+i+'}'))},payerComparisons:[{platform:'win',from:'2026-10-01',through:'2026-10-20',rows:Array.from({length:300},(_,i)=>({aid:String(i).padStart(22,'0'),name:'example',previousCash:0,currentCash:null,cashDelta:null,source:{labels:['same']},...(i%2?{optional:null}:{})}))}]};}
test('comparison machine and exact payer rows roundtrip losslessly with a version-two guard older decoders reject',()=>{
 const original=detailFixture(),before=JSON.stringify(original),wire=encodeDashboardPayload(original),transport=json(wire),decoded=decode(transport);
 assert.equal(wire.archiveWire.version,2);assert.equal(wire.machines.rows.encoding,'column-dictionary-details-v1');assert.equal(wire.machines.comparisonRows.encoding,'column-dictionary-v1');assert.equal(wire.payerComparisons[0].rows.encoding,'column-dictionary-v1');assert.throws(()=>previousArchiveVersionValidation(wire),TypeError);assert.throws(()=>previousDictionaryValidation(wire),TypeError);assert.deepEqual(json(decoded),json(original));assert.equal(JSON.stringify(original),before);assert.equal(JSON.stringify(transport),JSON.stringify(wire));assert(bytes(wire)<bytes(original)*.6);
 decoded.machines.comparisonRows[0].source.notes.push('changed');assert.equal(decoded.machines.comparisonRows[1].source.notes.length,1);decoded.payerComparisons[0].rows[0].source.labels.push('changed');assert.equal(decoded.payerComparisons[0].rows[1].source.labels.length,1);assert(Object.hasOwn(decoded.machines.comparisonRows[0],'__proto__'));assert.equal({}.safe,undefined);assert.equal(Object.hasOwn(decoded.payerComparisons[0].rows[0],'optional'),false);assert.equal(decoded.payerComparisons[0].rows[1].optional,null);
});
test('details-only guard preserves absent/null machines, absent/null main rows and comparison arrays without restoring encoded wrappers',()=>{
 for(const original of [{payerComparisons:detailFixture().payerComparisons},{machines:null,payerComparisons:[]},{machines:{comparisonRows:detailFixture().machines.comparisonRows,meta:'keep'}},{machines:{rows:null,comparisonRows:[],meta:'keep'},payerComparisons:[{rows:[]}]}]){const wire=encodeDashboardPayload(original),decoded=decode(json(wire));assert.deepEqual(json(decoded),json(original));if(wire.archiveWire)assert.equal(wire.archiveWire.version,2);}
 const own=archiveFixture(),original={...detailFixture(),competitorArchive:own,competitorArchives:{platforms:[own]}},wire=encodeDashboardPayload(original);assert.equal(wire.archiveWire.version,2);assert.deepEqual(json(decode(json(wire))),json(original));
});
test('new decoder still accepts original comparison objects, old row wire and archive version one',()=>{
 const raw=detailFixture();assert.equal(decode(raw),raw);const older=encodeDashboardPayload({machines:{rows:[{bets:0}]},competitorArchive:archiveFixture()});assert.equal(older.archiveWire.version,1);assert.deepEqual(json(decode(json(older))),json({machines:{rows:[{bets:0}]},competitorArchive:archiveFixture()}));
});
test('missing or downgraded details marker, malformed comparison columns and invalid synthetic guard fail explicitly',()=>{
 const base=encodeDashboardPayload(detailFixture());for(const edit of [d=>{delete d.archiveWire;},d=>{d.archiveWire.version=1;},d=>{d.machines.comparisonRows.length=-1;},d=>{d.payerComparisons[0].rows.columns[0]={dictionary:['a'],indexes:[9]};}]){const bad=json(base);edit(bad);assert.throws(()=>decode(bad),{name:'TypeError'});}
 const synthetic=encodeDashboardPayload({machines:{comparisonRows:[]}});for(const edit of [d=>{d.archiveWire.syntheticMachineGuard.hadObject='yes';},d=>{d.archiveWire.syntheticMachineGuard.hadRows=true;delete d.archiveWire.syntheticMachineGuard.rowsValue;},d=>{d.archiveWire.syntheticMachineGuard.hadRows=true;d.archiveWire.syntheticMachineGuard.rowsValue=[];}]){const bad=json(synthetic);edit(bad);assert.throws(()=>decode(bad),{name:'TypeError'});}
});
test('fixed-width raw arrays use lossless per-position columns only when smaller and retain nested cell independence',()=>{
 const raw=Array.from({length:200},(_,i)=>({raw:['vendor','game '+i%5,i,null,{labels:['same']}],bets:0,maybe:i%2?null:undefined})),original={machines:{rows:raw}},before=JSON.stringify(original),wire=encodeDashboardPayload(original),position=wire.machines.rowFields.indexOf('raw'),matrix=wire.machines.rows.columns[position].arrayColumns,decoded=decode(json(wire));
 assert.equal(wire.archiveWire.version,2);assert(matrix);assert.equal(matrix.width,5);assert.deepEqual(json(decoded),json(original));assert.equal(JSON.stringify(original),before);assert(bytes(wire)<bytes(original)*.65);decoded.machines.rows[0].raw[4].labels.push('changed');assert.equal(decoded.machines.rows[1].raw[4].labels.length,1);assert.equal(decoded.machines.rows[1].raw[3],null);assert.equal(decoded.machines.rows[0].raw[2],0);assert.equal(Object.hasOwn(decoded.machines.rows[0],'maybe'),false);
 const mixed={machines:{rows:[{raw:[1,null]},{raw:null},{raw:[]},{other:'missing'},{raw:[1,2,3]}]}};assert.deepEqual(json(decode(json(encodeDashboardPayload(mixed)))),mixed);
});
test('malformed or unversioned raw-array transposition is rejected before allocating or misaligning array cells',()=>{
 const base=encodeDashboardPayload({machines:{rows:Array.from({length:20},(_,i)=>({raw:['same','same',i]}))}}),index=base.machines.rowFields.indexOf('raw');assert(base.machines.rows.columns[index].arrayColumns);
 for(const edit of [d=>{d.archiveWire.version=1;d.machines.rows.encoding='column-dictionary-v1';},d=>{d.machines.rows.columns[index].arrayColumns.width=-1;},d=>{d.machines.rows.columns[index].arrayColumns.columns.pop();},d=>{d.machines.rows.columns[index].arrayColumns.columns[0]={values:[]};},d=>{d.machines.rows.columns[index].arrayColumns.columns[0]={arrayColumns:{width:1,columns:[{constant:0}]}};}]){const bad=json(base);edit(bad);assert.throws(()=>decode(bad),{name:'TypeError'});}
});

test('platform channel players use a version-three guard and roundtrip source fields, missing values and nested cells independently',()=>{
 const nested=JSON.parse('{"__proto__":{"safe":true},"steps":[0,null,"來源"]}'),players=Array.from({length:200},(_,i)=>({aid:String(i).padStart(12,'0'),name:'same repeated nickname',platform:'goldfun',channel:'a long repeated source channel',from:'2026-10-01',cutoff:'2026-10-20',firstperiodCash:i%3?0:null,nested,...(i%2?{optional:undefined}:{bound:false})})),original={channelsByPlatform:{schema:1,platforms:[{platform:'goldfun',players,periods:[{from:'2026-10-01',through:'2026-10-20',complete:true}]},{platform:'o9',players:[]},{platform:'win',players:null},{platform:'qz',unknown:'keep'}]}},before=JSON.stringify(original),wire=encodeDashboardPayload(original),transport=json(wire),decoded=decode(transport);
 assert.equal(wire.archiveWire.version,3);assert.equal(wire.machines.rows.encoding,'column-dictionary-channels-v1');assert.equal(wire.channelsByPlatform.platforms[0].players.encoding,'column-dictionary-v1');assert(Array.isArray(wire.channelsByPlatform.platforms[0].playerFields));assert.deepEqual(json(decoded),json(original));assert.equal(JSON.stringify(original),before);assert.equal(JSON.stringify(transport),JSON.stringify(wire));assert(bytes(wire)<bytes(original)*.45);
 assert.throws(()=>legacyV1Decoder(wire),TypeError);assert.throws(()=>previousArchiveVersionValidation(wire),TypeError);const oldV2=value=>{if(value.archiveWire&&!([1,2].includes(value.archiveWire.version)))throw TypeError('unsupported archive wire version');return previousDictionaryValidation(value);};assert.throws(()=>oldV2(wire),TypeError);
 decoded.channelsByPlatform.platforms[0].players[0].nested.steps.push('changed');assert.equal(decoded.channelsByPlatform.platforms[0].players[1].nested.steps.length,3);assert.equal(original.channelsByPlatform.platforms[0].players[0].nested.steps.length,3);assert(Object.hasOwn(decoded.channelsByPlatform.platforms[0].players[0].nested,'__proto__'));assert.equal({}.safe,undefined);assert.equal(Object.hasOwn(decoded.channelsByPlatform.platforms[0].players[1],'bound'),false);assert.equal(decoded.channelsByPlatform.platforms[0].players[0].firstperiodCash,null);assert.equal(decoded.channelsByPlatform.platforms[0].players[1].firstperiodCash,0);
 for(const edit of [w=>delete w.archiveWire,w=>w.archiveWire.version=2,w=>w.channelsByPlatform.platforms[0].players.length=-1,w=>w.channelsByPlatform.platforms[0].playerFields.push('aid')]){const bad=json(wire);edit(bad);assert.throws(()=>decode(bad),{name:'TypeError'});}
});
test('channel-only synthetic guards preserve absent/null machines and legacy uncompressed channel objects remain usable',()=>{for(const original of [{channelsByPlatform:{platforms:[{players:[]}]}},{machines:null,channelsByPlatform:{platforms:[{players:[{}]}]}},{machines:{rows:null,meta:0},channelsByPlatform:{platforms:[{players:[{empty:'',no:false,missing:undefined}]}]}},{channelsByPlatform:null},{channelsByPlatform:{platforms:null}},{channelsByPlatform:{schema:1}}]){const wire=encodeDashboardPayload(original);assert.deepEqual(json(decode(json(wire))),json(original));}const raw={channelsByPlatform:{platforms:[{players:[{aid:'001'}]}]}};assert.equal(decode(raw),raw);});
test('canonical JSON-string observation tuples compress without changing escaping, types or malformed legacy strings',()=>{
 const rows=Array.from({length:300},(_,i)=>({observationKey:JSON.stringify(['platform','2026-09-01','2026-09-30','vendor','',i%2?'名字\\slash':'引號"名字',i]),raw:JSON.stringify(['constant',null,0,false,{x:'中'}])})),original={machines:{rows},channels:{platform:'win',players:[{aid:'001',cash:0},{aid:'002',cash:null}]}},wire=encodeDashboardPayload(original),decoded=decode(json(wire)),index=wire.machines.rowFields.indexOf('observationKey');assert.equal(wire.archiveWire.version,3);assert(wire.machines.rows.columns[index].jsonStringColumns);assert.deepEqual(json(decoded),json(original));assert(bytes(wire)<bytes(original)*.45);assert(Array.isArray(decoded.channels.players));
 const noncanonical={machines:{rows:[{key:'[ 1, 2 ]'},{key:'[1,2]'}, {key:'[invalid]'}]}};assert.deepEqual(json(decode(json(encodeDashboardPayload(noncanonical)))),noncanonical);
 for(const edit of [w=>w.archiveWire.version=2,w=>w.machines.rows.columns[index].jsonStringColumns.width=-1,w=>w.machines.rows.columns[index].jsonStringColumns.columns.pop(),w=>w.machines.rows.columns[index].jsonStringColumns.columns[0]={values:[]}]){const bad=json(wire);edit(bad);assert.throws(()=>decode(bad),{name:'TypeError'});}
});
test('same-row machine raw references preserve exact calculated values, rare overrides and unknowns with an acyclic dependency guard',()=>{
 const rows=Array.from({length:250},(_,i)=>{const bets=10+i,payouts=12+i*2,pct=(payouts/bets*100).toFixed(2)+'%',vendor=i===0?null:'Vendor',machineName=i===1?'Verified override':'Machine',r={platform:'goldfun',from:'2026-10-01',through:'2026-10-20',vendor,machineName,machineId:null,sourceRow:i+1,players:1,rounds:100,bets,effectiveBets:bets,payouts,gameProfit:bets-payouts,eventBonus:0,reportedRtpRaw:pct,reportedRtp:Number(pct.slice(0,-1))/100,rtp:payouts/bets,platformLoss:payouts-bets,raw:['Vendor','Machine','1','100',bets.toFixed(2),bets.toFixed(2),payouts.toFixed(2),(bets-payouts).toFixed(2),pct,'-20.00%','0.00']};r.observationKey=JSON.stringify([r.platform,r.from,r.through,r.vendor??'',r.machineId??'',r.machineName??'',r.sourceRow]);return r;}),original={machines:{rows}},before=JSON.stringify(original),wire=encodeDashboardPayload(original),decoded=decode(json(wire)),at=name=>wire.machines.rowFields.indexOf(name),column=name=>wire.machines.rows.columns[at(name)];assert.equal(wire.archiveWire.version,3);assert.equal(column('bets').rowDerived.op,'number');assert.equal(column('rtp').rowDerived.op,'divide');assert.equal(column('platformLoss').rowDerived.op,'subtract');assert.equal(column('observationKey').rowDerived.op,'jsonTuple');assert.deepEqual(column('vendor').rowDerived.exceptions,[[0,null]]);assert.deepEqual(json(decoded),original);assert.equal(JSON.stringify(original),before);assert(bytes(wire)<bytes(original)*.12);
 for(const edit of [w=>w.archiveWire.version=2,w=>w.machines.rows.columns[at('bets')].rowDerived.op='eval',w=>w.machines.rows.columns[at('bets')].rowDerived.column=at('bets'),w=>w.machines.rows.columns[at('raw')]={rowDerived:{op:'value',column:at('bets')}},w=>w.machines.rows.columns[at('bets')].rowDerived.index=100,w=>w.machines.rows.columns[at('reportedRtp')].rowDerived.divisor=0,w=>w.machines.rows.columns[at('vendor')].rowDerived.exceptions=[[0,null],[0,'bad']],w=>w.machines.rows.columns[at('vendor')].rowDerived.exceptions=[[999,null]]]){const bad=json(wire);edit(bad);assert.throws(()=>decode(bad),{name:'TypeError'});}
 const copied={cohorts:[{rows:Array.from({length:50},(_,i)=>({a:{items:[i,'same repeated object payload']},b:{items:[i,'same repeated object payload']}}))}]},copy=decode(json(encodeDashboardPayload(copied)));copy.cohorts[0].rows[0].a.items.push('mutated');assert.equal(copy.cohorts[0].rows[0].b.items.length,2);assert.equal(copied.cohorts[0].rows[0].a.items.length,2);
});
test('resource ledger array rows transpose losslessly, retain all original rows and reject malformed restoration markers',()=>{
 const original={investigation:[{aid:'synthetic',rows:Array.from({length:100},(_,i)=>['date','type','reason',i,null,{items:['same']},undefined,''])},{rows:[]},{rows:null},{other:'missing'}]},before=JSON.stringify(original),wire=encodeDashboardPayload(original),decoded=decode(json(wire));assert.equal(wire.archiveWire.version,3);assert.equal(wire.investigation[0].resourceRowArray,true);assert.deepEqual(json(decoded),json(original));assert.equal(JSON.stringify(original),before);decoded.investigation[0].rows[0][5].items.push('changed');assert.equal(decoded.investigation[0].rows[1][5].items.length,1);assert(bytes(wire)<bytes(original)*.5);
 for(const edit of [w=>w.archiveWire.version=2,w=>delete w.investigation[0].resourceRowArray,w=>w.investigation[0].resourceRowArray=false,w=>w.investigation[0].rows.columns=[{constant:3}]]){const bad=json(wire);edit(bad);assert.throws(()=>decode(bad),{name:'TypeError'});}
});
