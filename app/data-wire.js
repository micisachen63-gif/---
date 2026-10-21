/** Decode v1 row tables or column-dictionary-v1 tables before reading the dashboard.
 * Dictionary/constant objects are cloned per cell, never shared across rows.
 * Legacy objects remain
 * usable. Missing keys and explicit null are different; masks preserve that fact.
 * This function does not mutate its argument. Original format returns unchanged.
 */
function decodeDashboardPayload(payload){
 const object=v=>v!==null&&typeof v==='object'&&!Array.isArray(v);
 if(!object(payload))throw TypeError('dashboard payload must be an object');
 const archiveWire=payload.archiveWire;
 if(archiveWire!==undefined&&(!object(archiveWire)||archiveWire.format!=='operations-archive-columns'||![1,2,3].includes(archiveWire.version)||!object(archiveWire.aliases)||Object.keys(archiveWire.aliases).some(k=>k!=='competitorArchive'||archiveWire.aliases[k]!=='o8')))throw TypeError('unsupported archive wire version or alias');
 const targets=[];
 const add=(table,rows,fields,missing,label)=>{
  if(!object(table))throw TypeError(label+' must be an object');
  if(Object.hasOwn(table,fields)||Object.hasOwn(table,missing))targets.push({table,rows,fields,missing,label});
  else if(Object.hasOwn(table,rows)&&table[rows]!==null){if(!Array.isArray(table[rows])||table[rows].some(r=>!object(r)))throw TypeError(label+' has invalid legacy rows')}
 };
 const visit=data=>{
  if(data.cohorts!==undefined&&data.cohorts!==null){if(!Array.isArray(data.cohorts))throw TypeError('cohorts must be an array');data.cohorts.forEach((c,i)=>add(c,'rows','rowFields','rowMissing','cohorts['+i+']'))}
  if(data.machines!==undefined&&data.machines!==null){add(data.machines,'rows','rowFields','rowMissing','machines');if((Object.hasOwn(data.machines,'comparisonFields')||Object.hasOwn(data.machines,'comparisonMissing'))&&![2,3].includes(archiveWire?.version))throw TypeError('unsupported machine comparison wire version');add(data.machines,'comparisonRows','comparisonFields','comparisonMissing','machines');}
  if(data.payerComparisons!==undefined&&data.payerComparisons!==null){if(!Array.isArray(data.payerComparisons))throw TypeError('payerComparisons must be an array');data.payerComparisons.forEach((c,i)=>{if((Object.hasOwn(c,'rowFields')||Object.hasOwn(c,'rowMissing'))&&![2,3].includes(archiveWire?.version))throw TypeError('unsupported payer comparison wire version');add(c,'rows','rowFields','rowMissing','payerComparisons['+i+']');});}
  if(data.payments!==undefined&&data.payments!==null){if(!object(data.payments))throw TypeError('payments must be an object');if(data.payments.months!==undefined&&data.payments.months!==null){if(!Array.isArray(data.payments.months))throw TypeError('payments.months must be an array');data.payments.months.forEach((m,i)=>add(m,'payers','payerFields','payerMissing','payments.months['+i+']'))}}
  if(data.merchantCandidates!==undefined&&data.merchantCandidates!==null){
   const merchant=data.merchantCandidates;if(!object(merchant))throw TypeError('merchantCandidates must be an object');
   const scan=(value,label)=>{for(const [rows,fields,missing]of [['accounts','accountFields','accountMissing'],['candidates','candidateFields','candidateMissing'],['confirmedMerchants','confirmedFields','confirmedMissing']])add(value,rows,fields,missing,label)};
   scan(merchant,'merchantCandidates');
   if(merchant.groups!==undefined&&merchant.groups!==null){if(!Array.isArray(merchant.groups))throw TypeError('merchantCandidates.groups must be an array');merchant.groups.forEach((g,i)=>scan(g,'merchantCandidates.groups['+i+']'))}
  }
  if(data.channelsByPlatform!==undefined&&data.channelsByPlatform!==null){
   if(!object(data.channelsByPlatform))throw TypeError('channelsByPlatform must be an object');
   const groups=data.channelsByPlatform.platforms;
   if(groups!==undefined&&groups!==null){if(!Array.isArray(groups))throw TypeError('channelsByPlatform.platforms must be an array');groups.forEach((g,i)=>{if((Object.hasOwn(g,'playerFields')||Object.hasOwn(g,'playerMissing'))&&archiveWire?.version!==3)throw TypeError('unsupported channel player wire version');add(g,'players','playerFields','playerMissing','channelsByPlatform.platforms['+i+']');});}
  }
  if(data.channels!==undefined&&data.channels!==null){if((Object.hasOwn(data.channels,'playerFields')||Object.hasOwn(data.channels,'playerMissing'))&&archiveWire?.version!==3)throw TypeError('unsupported legacy channel player wire version');add(data.channels,'players','playerFields','playerMissing','channels');}
  if(data.investigation!==undefined&&data.investigation!==null){if(!Array.isArray(data.investigation))throw TypeError('investigation must be an array');data.investigation.forEach((snapshot,i)=>{if(!object(snapshot))throw TypeError('investigation snapshot must be an object');if(Object.hasOwn(snapshot,'resourceRowArray')||Object.hasOwn(snapshot,'resourceFields')||Object.hasOwn(snapshot,'resourceMissing')){if(archiveWire?.version!==3||snapshot.resourceRowArray!==true)throw TypeError('unsupported resource row-array wire version');add(snapshot,'rows','resourceFields','resourceMissing','investigation['+i+']');}});}
  const scanArchive=(archive,label)=>{
   if(!object(archive))throw TypeError(label+' must be an object');
   for(const [rows,fields,missing]of [['daily','dailyFields','dailyMissing'],['monthly','monthFields','monthMissing']])add(archive,rows,fields,missing,label);
   if(archive.history!==undefined&&archive.history!==null){if(!object(archive.history))throw TypeError(label+'.history must be an object');for(const [rows,fields,missing]of [['daily','dailyFields','dailyMissing'],['monthly','monthFields','monthMissing'],['operatingDaily','operatingFields','operatingMissing'],['operatingMonthly','operatingMonthFields','operatingMonthMissing'],['registrationMonths','registrationFields','registrationMissing'],['sources','sourceFields','sourceMissing'],['operatingSources','operatingSourceFields','operatingSourceMissing']])add(archive.history,rows,fields,missing,label+'.history');}
  };
  if(data.competitorArchives!==undefined&&data.competitorArchives!==null){if(!object(data.competitorArchives)||!Array.isArray(data.competitorArchives.platforms))throw TypeError('competitorArchives.platforms must be an array');data.competitorArchives.platforms.forEach((a,i)=>scanArchive(a,'competitorArchives.platforms['+i+']'));}
  if(data.competitorArchive!==undefined&&data.competitorArchive!==null)scanArchive(data.competitorArchive,'competitorArchive');
 };
 visit(payload);if(!targets.length){if(archiveWire)throw TypeError('archive wire marker is missing its dictionary guard');return payload;}
 const data=JSON.parse(JSON.stringify(payload));targets.length=0;visit(data);
 const cloneCell=value=>value===null||typeof value!=='object'?value:Array.isArray(value)?value.map(cloneCell):Object.fromEntries(Object.entries(value).map(([k,v])=>[k,cloneCell(v)]));
 for(const {table,rows:rowsKey,fields:fieldsKey,missing:missingKey,label} of targets){
  const fields=table[fieldsKey],encoded=table[rowsKey];
  if(!Array.isArray(fields)||fields.some(k=>typeof k!=='string')||new Set(fields).size!==fields.length)throw TypeError(label+' has invalid or duplicate field names');
  let count,readCell;
  if(Array.isArray(encoded)){
   if(encoded.some(r=>!Array.isArray(r)||r.length!==fields.length))throw TypeError(label+' has invalid wire row width');count=encoded.length;readCell=(r,c)=>encoded[r][c];
  }else{
   if(!object(encoded)||!(encoded.encoding==='column-dictionary-v1'||archiveWire&&encoded.encoding==='column-dictionary-archive-v1'||[2,3].includes(archiveWire?.version)&&encoded.encoding==='column-dictionary-details-v1'||archiveWire?.version===3&&encoded.encoding==='column-dictionary-channels-v1')||!Number.isSafeInteger(encoded.length)||encoded.length<0||!Array.isArray(encoded.columns)||encoded.columns.length!==fields.length)throw TypeError(label+' has invalid dictionary wrapper');
   count=encoded.length;
   const dependencyColumns=rule=>rule.op==='value'||rule.op==='cell'||rule.op==='number'?[rule.column]:rule.columns,derivedExceptions=new WeakMap();
   const validateColumn=(column,depth=0,columnIndex=null)=>{
    if(!object(column))throw TypeError(label+' has invalid dictionary column');
    const kinds=['constant','values','dictionary','arrayColumns','jsonStringColumns','rowDerived'].filter(k=>Object.hasOwn(column,k));if(kinds.length!==1)throw TypeError(label+' has ambiguous dictionary column');
    if(kinds[0]==='values'&&(!Array.isArray(column.values)||column.values.length!==count))throw TypeError(label+' has invalid plain column length');
    if(kinds[0]==='dictionary'&&(!Array.isArray(column.dictionary)||!column.dictionary.length||!Array.isArray(column.indexes)||column.indexes.length!==count||column.indexes.some(i=>!Number.isInteger(i)||i<0||i>=column.dictionary.length)))throw TypeError(label+' has invalid dictionary indexes');
    if(kinds[0]==='arrayColumns'){const matrix=column.arrayColumns;if(![2,3].includes(archiveWire?.version)||depth!==0||!object(matrix)||!Number.isSafeInteger(matrix.width)||matrix.width<=0||!Array.isArray(matrix.columns)||matrix.columns.length!==matrix.width)throw TypeError(label+' has invalid nested array columns');matrix.columns.forEach(c=>validateColumn(c,depth+1));}
    if(kinds[0]==='jsonStringColumns'){const matrix=column.jsonStringColumns;if(archiveWire?.version!==3||depth!==0||!object(matrix)||!Number.isSafeInteger(matrix.width)||matrix.width<=0||!Array.isArray(matrix.columns)||matrix.columns.length!==matrix.width)throw TypeError(label+' has invalid JSON-string tuple columns');matrix.columns.forEach(c=>validateColumn(c,depth+1));}
    if(kinds[0]==='rowDerived'){const rule=column.rowDerived,ops=['value','cell','number','subtract','divide','jsonTuple'];if(archiveWire?.version!==3||depth!==0||!Number.isInteger(columnIndex)||!object(rule)||!ops.includes(rule.op))throw TypeError(label+' has invalid row-derived column');const deps=dependencyColumns(rule);if(!Array.isArray(deps)||!deps.length||deps.some(i=>!Number.isInteger(i)||i<0||i>=fields.length||i===columnIndex)||['subtract','divide'].includes(rule.op)&&deps.length!==2||['cell','number'].includes(rule.op)&&(!Number.isInteger(rule.index)||rule.index<0)||rule.op==='number'&&rule.divisor!==undefined&&![1,100].includes(rule.divisor)||rule.op==='jsonTuple'&&typeof rule.nullAsEmpty!=='boolean')throw TypeError(label+' has invalid row-derived dependencies');if(rule.exceptions!==undefined){if(!Array.isArray(rule.exceptions))throw TypeError(label+' has invalid derived exceptions');const map=new Map();for(const item of rule.exceptions){if(!Array.isArray(item)||item.length!==2||!Number.isInteger(item[0])||item[0]<0||item[0]>=count||map.has(item[0]))throw TypeError(label+' has invalid derived exception row');map.set(item[0],item[1]);}derivedExceptions.set(rule,map);}}
   };
   encoded.columns.forEach((c,i)=>validateColumn(c,0,i));
   const states=new Uint8Array(fields.length),visitDependency=i=>{if(states[i]===1)throw TypeError(label+' has cyclic row-derived columns');if(states[i]===2)return;states[i]=1;const rule=encoded.columns[i].rowDerived;if(rule)dependencyColumns(rule).forEach(visitDependency);states[i]=2;};encoded.columns.forEach((_,i)=>visitDependency(i));
   const wireNumber=value=>{if(typeof value==='number')return Number.isFinite(value)?value:null;if(typeof value!=='string')return null;const text=value.trim().replaceAll(',','').replace(/[％%]$/,'');return /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/.test(text)&&Number.isFinite(Number(text))?Number(text):null;};
   const readDerived=(rule,r)=>{const exceptions=derivedExceptions.get(rule);if(exceptions?.has(r))return exceptions.get(r);const get=i=>readColumn(encoded.columns[i],r);if(rule.op==='value')return get(rule.column);if(rule.op==='cell'||rule.op==='number'){const source=get(rule.column);if(!Array.isArray(source)||rule.index>=source.length)throw TypeError(label+' has invalid row-derived array cell');const value=source[rule.index];if(rule.op==='cell')return value;const number=wireNumber(value);return number===null?null:number/(rule.divisor??1);}if(rule.op==='jsonTuple')return JSON.stringify(rule.columns.map(i=>{const value=get(i);return rule.nullAsEmpty&&value==null?'':value;}));const a=get(rule.columns[0]),b=get(rule.columns[1]);if(typeof a!=='number'||!Number.isFinite(a)||typeof b!=='number'||!Number.isFinite(b)||rule.op==='divide'&&b<=0)return null;const value=rule.op==='subtract'?a-b:a/b;return Number.isFinite(value)?value===0?0:value:null;};
   const readColumn=(column,r)=>Object.hasOwn(column,'constant')?column.constant:Object.hasOwn(column,'values')?column.values[r]:Object.hasOwn(column,'arrayColumns')?column.arrayColumns.columns.map(c=>readColumn(c,r)):Object.hasOwn(column,'jsonStringColumns')?JSON.stringify(column.jsonStringColumns.columns.map(c=>readColumn(c,r))):Object.hasOwn(column,'rowDerived')?readDerived(column.rowDerived,r):column.dictionary[column.indexes[r]];
   readCell=(r,c)=>readColumn(encoded.columns[c],r);
  }
  const omitted=new Map(),mask=table[missingKey];
  if(mask!==undefined){
   if(!Array.isArray(mask))throw TypeError(label+' has invalid missing-key masks');
   for(const entry of mask){
    if(!Array.isArray(entry)||entry.length<2)throw TypeError(label+' has invalid missing-key mask');
    const [index,...indexes]=entry;
    if(!Number.isInteger(index)||index<0||index>=count||omitted.has(index)||indexes.some(i=>!Number.isInteger(i)||i<0||i>=fields.length)||new Set(indexes).size!==indexes.length)throw TypeError(label+' has out-of-range or duplicate missing-key mask');
    if(indexes.some(i=>readCell(index,i)!==null))throw TypeError(label+' missing-key placeholder must be null');
    omitted.set(index,new Set(indexes));
   }
  }
  // fromEntries creates safe own properties even for JSON keys like __proto__.
  table[rowsKey]=Array.from({length:count},(_,index)=>Object.fromEntries(fields.flatMap((key,i)=>omitted.get(index)?.has(i)?[]:[[key,cloneCell(readCell(index,i))]])));
  delete table[fieldsKey];delete table[missingKey];
 }
 if(archiveWire){
  for(const snapshot of data.investigation??[])if(snapshot.resourceRowArray===true){if(!Array.isArray(snapshot.rows)||snapshot.rows.some(row=>!object(row)||Object.keys(row).length!==1||!Array.isArray(row.value)))throw TypeError('invalid decoded resource row array');snapshot.rows=snapshot.rows.map(row=>row.value);delete snapshot.resourceRowArray;}
  if(archiveWire.syntheticMachineGuard){const guard=archiveWire.syntheticMachineGuard;if(guard.mode==='rows-only'){
   if(![2,3].includes(archiveWire.version)||typeof guard.hadOwn!=='boolean'||typeof guard.hadObject!=='boolean'||guard.hadObject&&(!guard.hadOwn||typeof guard.hadRows!=='boolean'||guard.hadRows&&(!Object.hasOwn(guard,'rowsValue')||guard.rowsValue!==null))||!guard.hadObject&&guard.hadOwn&&(!Object.hasOwn(guard,'value')||guard.value!==null))throw TypeError('invalid synthetic details guard');
   if(!guard.hadOwn)delete data.machines;else if(!guard.hadObject)data.machines=cloneCell(guard.value);else if(guard.hadRows)data.machines.rows=cloneCell(guard.rowsValue);else delete data.machines.rows;
  }else{if(!object(guard)||typeof guard.hadOwn!=='boolean'||guard.hadOwn&&!Object.hasOwn(guard,'value'))throw TypeError('invalid synthetic archive guard');if(guard.hadOwn)data.machines=cloneCell(guard.value);else delete data.machines;}}
  if(archiveWire.aliases.competitorArchive){const candidates=data.competitorArchives?.platforms?.filter(a=>a.platform==='o8');if(candidates?.length!==1||Object.hasOwn(data,'competitorArchive'))throw TypeError('invalid archive alias target');data.competitorArchive=cloneCell(candidates[0]);}
  delete data.archiveWire;
 }
 return data;
}

// The outer envelope keeps Worker schema/stale checks cheap. No decompression
// takes place on the Worker; all authenticated data is streamed to this client.
async function decodeDashboardTransport(payload){
 const object=v=>v!==null&&typeof v==='object'&&!Array.isArray(v),has=(v,k)=>Object.hasOwn(v,k),limit={decodedBytes:128*1024*1024,decodedChars:128*1024*1024,compressedBytes:11*1024*1024,requestChars:15000000};
 if(!object(payload))throw TypeError('dashboard payload must be an object');
 if(payload.transport?.format!=='operations-dashboard-transport'&&payload.archiveWire?.version!==4)return decodeDashboardPayload(payload);
 const m=payload.transport,guard=payload.archiveWire,keys=['schema','generatedAt','platforms','monthly','archiveWire','transport','payload'],metaKeys=['format','version','encoding','rawBytes','rawChars','compressedBytes','sha256'];
 if(Object.keys(payload).length!==keys.length||keys.some(k=>!has(payload,k))||!object(m)||Object.keys(m).length!==metaKeys.length||metaKeys.some(k=>!has(m,k))||m.format!=='operations-dashboard-transport'||m.version!==1||m.encoding!=='gzip-base64')throw TypeError('unsupported dashboard transport');
 if(!object(guard)||guard.format!=='operations-archive-columns'||guard.version!==4||!object(guard.aliases)||Object.keys(guard).length!==3||Object.keys(guard.aliases).length||payload.schema!==1||!Number.isFinite(Date.parse(payload.generatedAt))||!Array.isArray(payload.platforms)||payload.platforms.length!==6||!Array.isArray(payload.monthly))throw TypeError('invalid dashboard transport metadata');
 if(!['rawBytes','rawChars','compressedBytes'].every(k=>Number.isSafeInteger(m[k])&&m[k]>0)||m.rawBytes>limit.decodedBytes||m.rawChars>limit.decodedChars||m.compressedBytes>limit.compressedBytes||m.rawChars>m.rawBytes||!/^([a-f0-9]{64})$/.test(m.sha256)||typeof payload.payload!=='string'||payload.payload.length>limit.requestChars||payload.payload.length!==4*Math.ceil(m.compressedBytes/3)||!/^[A-Za-z0-9+/]*={0,2}$/.test(payload.payload))throw RangeError('dashboard transport bounds invalid');
 if(typeof DecompressionStream!=='function'||typeof crypto==='undefined'||typeof crypto.subtle?.digest!=='function'||typeof atob!=='function')throw Error('此瀏覽器不支援安全資料解壓，請更新瀏覽器');
 const binary=atob(payload.payload);if(binary.length!==m.compressedBytes)throw TypeError('dashboard compressed length mismatch');const compressed=Uint8Array.from(binary,c=>c.charCodeAt(0));if(compressed[0]!==31||compressed[1]!==139||compressed[2]!==8)throw TypeError('invalid dashboard gzip header');
 const reader=new Blob([compressed]).stream().pipeThrough(new DecompressionStream('gzip')).getReader(),chunks=[];let size=0;
 try{for(;;){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>m.rawBytes||size>limit.decodedBytes)throw RangeError('dashboard decompression limit exceeded');chunks.push(value);}}catch(error){await reader.cancel().catch(()=>{});throw error;}finally{reader.releaseLock();}
 if(size!==m.rawBytes)throw TypeError('dashboard decompressed length mismatch');const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.byteLength;}
 const hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),b=>b.toString(16).padStart(2,'0')).join('');if(hash!==m.sha256)throw TypeError('dashboard transport checksum mismatch');
 const text=new TextDecoder('utf-8',{fatal:true}).decode(bytes);if(text.length!==m.rawChars||text.length>limit.decodedChars)throw TypeError('dashboard character length mismatch');const inner=JSON.parse(text);
 if(!object(inner)||inner.schema!==payload.schema||inner.generatedAt!==payload.generatedAt||JSON.stringify(inner.platforms)!==JSON.stringify(payload.platforms)||JSON.stringify(inner.monthly)!==JSON.stringify(payload.monthly)||inner.transport?.format==='operations-dashboard-transport')throw TypeError('dashboard transport metadata mismatch');
 return decodeDashboardPayload(inner);
}
