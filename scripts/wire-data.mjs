/** Lossless JSON transport encoding. The local dashboard and raw captures stay unchanged.
 * Field names and missing-key masks accompany column-dictionary-v1 wrappers.
 * Constant columns and exact JSON-value dictionaries preserve every cell.
 * The non-array rows wrapper makes v1 decoders reject the newer encoding.
 * Missing object keys use null placeholders plus [rowIndex,fieldIndex,...] masks.
 * Explicit null stays null. Undefined object properties follow JSON omission rules;
 * undefined array values follow JSON's null rule. Invalid table rows are rejected.
 */
function object(value){return value!==null&&typeof value==='object'&&!Array.isArray(value)}
function wireNumber(value){if(typeof value==='number')return Number.isFinite(value)?value:null;if(typeof value!=='string')return null;const text=value.trim().replaceAll(',','').replace(/[％%]$/,'');return /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/.test(text)&&Number.isFinite(Number(text))?Number(text):null;}
function encodeColumn(cells,allowMatrix=true){
 const plain={values:cells},dictionary=[],indexes=[],lookup=new Map();
 for(const value of cells){const signature=JSON.stringify(value);if(!lookup.has(signature)){lookup.set(signature,dictionary.length);dictionary.push(value)}indexes.push(lookup.get(signature))}
 const options=[plain];if(dictionary.length===1)options.push({constant:dictionary[0]});if(dictionary.length&&dictionary.length<cells.length)options.push({dictionary,indexes});
 if(allowMatrix&&cells.length>1&&cells.every(Array.isArray)&&cells[0].length>0&&cells.every(c=>c.length===cells[0].length))options.push({arrayColumns:{width:cells[0].length,columns:Array.from({length:cells[0].length},(_,i)=>encodeColumn(cells.map(row=>row[i]),false))}});
 // Observation keys contain canonical JSON tuples. Store their positions once
 // while retaining the exact original strings (including JSON escaping rules).
 if(allowMatrix&&cells.length>1&&typeof cells[0]==='string'&&cells[0].startsWith('[')&&cells.every(v=>typeof v==='string'))try{const tuples=cells.map(v=>JSON.parse(v));if(tuples[0].length>0&&tuples.every((v,i)=>Array.isArray(v)&&v.length===tuples[0].length&&JSON.stringify(v)===cells[i]))options.push({jsonStringColumns:{width:tuples[0].length,columns:Array.from({length:tuples[0].length},(_,i)=>encodeColumn(tuples.map(row=>row[i]),false))}});}catch{}
 return options.reduce((best,next)=>JSON.stringify(next).length<JSON.stringify(best).length?next:best);
}
function encodeTableBase(table,rowsKey,fieldsKey,missingKey,label){
 if(!object(table))throw TypeError(label+' must be an object');
 if(Object.hasOwn(table,fieldsKey)||Object.hasOwn(table,missingKey))throw TypeError(label+' already contains reserved wire fields');
 if(!Object.hasOwn(table,rowsKey)||table[rowsKey]===null)return;
 const rows=table[rowsKey];if(!Array.isArray(rows))throw TypeError(label+'.'+rowsKey+' must be an array or null');
 const fields=[],seen=new Set();
 for(const row of rows){if(!object(row))throw TypeError(label+' contains a non-object row');for(const key of Object.keys(row))if(!seen.has(key)){seen.add(key);fields.push(key)}}
 const missing=[],values=rows.map((row,index)=>{const omitted=[];const cells=fields.map((key,i)=>{if(!Object.hasOwn(row,key)){omitted.push(i);return null}return row[key]});if(omitted.length)missing.push([index,...omitted]);return cells});
 const columns=fields.map((_,column)=>encodeColumn(values.map(row=>row[column])));
 let derived=false;const signatures=new Map(),columnValues=fields.map((_,i)=>values.map(row=>row[i]));
 // These references remove only values already present elsewhere in the same
 // row. Full-column equality is proven before choosing any representation.
 const candidate=(index,rule,computed,allowExceptions=false)=>{if(index<0)return;const same=JSON.stringify(computed)===JSON.stringify(columnValues[index]),exceptions=!same&&allowExceptions?columnValues[index].flatMap((value,i)=>JSON.stringify(value)===JSON.stringify(computed[i])?[]:[[i,value]]):[];if(!same&&!allowExceptions)return;const next={rowDerived:{...rule,...(exceptions.length?{exceptions}:{})}};if(JSON.stringify(next).length<JSON.stringify(columns[index]).length){columns[index]=next;derived=true;}};
 fields.forEach((_,i)=>{const signature=JSON.stringify(columnValues[i]),prior=signatures.get(signature);if(prior!==undefined)candidate(i,{op:'value',column:prior},columnValues[prior]);else signatures.set(signature,i);});
 if(label==='machines'){
  const raw=fields.indexOf('raw');if(raw>=0&&columnValues[raw].every(Array.isArray)){
   for(const [name,index,numeric,divisor]of [['vendor',0,false],['machineName',1,false],['gameName',1,false],['players',2,true],['rounds',3,true],['bets',4,true],['effectiveBets',5,true],['payouts',6,true],['gameProfit',7,true],['reportedRtpRaw',8,false],['reportedRtp',8,true,100],['eventBonus',10,true]]){if(!columnValues[raw].every(row=>index<row.length))continue;const field=fields.indexOf(name),computed=columnValues[raw].map(row=>numeric?(wireNumber(row[index])===null?null:wireNumber(row[index])/(divisor??1)):row[index]);candidate(field,{op:numeric?'number':'cell',column:raw,index,...(divisor?{divisor}:{})},computed,true);}
  }
  const payouts=fields.indexOf('payouts'),bets=fields.indexOf('bets');if(payouts>=0&&bets>=0){const valid=(a,b)=>typeof a==='number'&&Number.isFinite(a)&&typeof b==='number'&&Number.isFinite(b);candidate(fields.indexOf('rtp'),{op:'divide',columns:[payouts,bets]},values.map(row=>valid(row[payouts],row[bets])&&row[bets]>0?row[payouts]/row[bets]:null));candidate(fields.indexOf('platformLoss'),{op:'subtract',columns:[payouts,bets]},values.map(row=>valid(row[payouts],row[bets])?row[payouts]-row[bets]:null));}
  const tuple=['platform','from','through','vendor','machineId','machineName','sourceRow'].map(f=>fields.indexOf(f));if(tuple.every(i=>i>=0))candidate(fields.indexOf('observationKey'),{op:'jsonTuple',columns:tuple,nullAsEmpty:true},values.map(row=>JSON.stringify(tuple.map(i=>row[i]??''))));
 }
 // A wrapper is intentional: old frontends reject non-array rows rather than
 // interpreting dictionary indexes as account IDs or financial amounts.
 table[rowsKey]={encoding:'column-dictionary-v1',length:rows.length,columns};
 table[fieldsKey]=fields;if(missing.length)table[missingKey]=missing;return{matrix:columns.some(c=>Object.hasOwn(c,'arrayColumns')),strings:columns.some(c=>Object.hasOwn(c,'jsonStringColumns')),derived};
}
export function encodeDashboardPayload(data){
 if(!object(data))throw TypeError('dashboard payload must be an object');
 if(Object.hasOwn(data,'archiveWire'))throw TypeError('archiveWire is reserved transport metadata');
 // Clone through the exact source JSON contract, rather than mutating local data.
 const result=JSON.parse(JSON.stringify(data));let legacyGuard=false,matrixEncoded=false,stringTuplesEncoded=false;
 const encodeTable=(...args)=>{const encoded=encodeTableBase(...args);if(encoded?.matrix)matrixEncoded=true;if(encoded?.strings||encoded?.derived)stringTuplesEncoded=true;return!!encoded;};
 if(result.cohorts!==undefined&&result.cohorts!==null){if(!Array.isArray(result.cohorts))throw TypeError('cohorts must be an array');result.cohorts.forEach((c,i)=>{if(encodeTable(c,'rows','rowFields','rowMissing','cohorts['+i+']'))legacyGuard=true})}
 if(result.machines!==undefined&&result.machines!==null&&encodeTable(result.machines,'rows','rowFields','rowMissing','machines'))legacyGuard=true;
 if(result.payments!==undefined&&result.payments!==null){
  if(!object(result.payments))throw TypeError('payments must be an object');
  const months=result.payments.months;
  if(months!==undefined&&months!==null){if(!Array.isArray(months))throw TypeError('payments.months must be an array');months.forEach((m,i)=>{if(encodeTable(m,'payers','payerFields','payerMissing','payments.months['+i+']'))legacyGuard=true})}
 }
 if(result.merchantCandidates!==undefined&&result.merchantCandidates!==null&&legacyGuard){
  const merchant=result.merchantCandidates;if(!object(merchant))throw TypeError('merchantCandidates must be an object');
  const encodeMerchant=(value,label)=>{for(const [rows,fields,missing]of [['accounts','accountFields','accountMissing'],['candidates','candidateFields','candidateMissing'],['confirmedMerchants','confirmedFields','confirmedMissing']])encodeTable(value,rows,fields,missing,label)};
  encodeMerchant(merchant,'merchantCandidates');
  if(merchant.groups!==undefined&&merchant.groups!==null){if(!Array.isArray(merchant.groups))throw TypeError('merchantCandidates.groups must be an array');merchant.groups.forEach((group,i)=>encodeMerchant(group,'merchantCandidates.groups['+i+']'))}
 }
 let archiveEncoded=false,detailsEncoded=false,channelsEncoded=false,resourceRowsEncoded=false;
 if(result.machines!==undefined&&result.machines!==null&&encodeTable(result.machines,'comparisonRows','comparisonFields','comparisonMissing','machines'))detailsEncoded=true;
 if(result.payerComparisons!==undefined&&result.payerComparisons!==null){if(!Array.isArray(result.payerComparisons))throw TypeError('payerComparisons must be an array');result.payerComparisons.forEach((c,i)=>{if(encodeTable(c,'rows','rowFields','rowMissing','payerComparisons['+i+']'))detailsEncoded=true;});}
 if(result.channelsByPlatform!==undefined&&result.channelsByPlatform!==null){
  if(!object(result.channelsByPlatform))throw TypeError('channelsByPlatform must be an object');
  const groups=result.channelsByPlatform.platforms;
  if(groups!==undefined&&groups!==null){if(!Array.isArray(groups))throw TypeError('channelsByPlatform.platforms must be an array');groups.forEach((group,i)=>{if(encodeTable(group,'players','playerFields','playerMissing','channelsByPlatform.platforms['+i+']'))channelsEncoded=true;});}
 }
 if(result.channels!==undefined&&result.channels!==null&&encodeTable(result.channels,'players','playerFields','playerMissing','channels'))channelsEncoded=true;
 if(result.investigation!==undefined&&result.investigation!==null){if(!Array.isArray(result.investigation))throw TypeError('investigation must be an array');result.investigation.forEach((snapshot,i)=>{if(!object(snapshot))throw TypeError('investigation snapshot must be an object');if(Object.hasOwn(snapshot,'resourceRowArray'))throw TypeError('resourceRowArray is reserved wire metadata');if(Array.isArray(snapshot.rows)&&snapshot.rows.every(Array.isArray)){snapshot.rows=snapshot.rows.map(value=>({value}));encodeTable(snapshot,'rows','resourceFields','resourceMissing','investigation['+i+']');snapshot.resourceRowArray=true;resourceRowsEncoded=true;}});}
 const encodeArchive=(archive,label)=>{
  if(!object(archive))throw TypeError(label+' must be an object');
  for(const [rows,fields,missing]of [['daily','dailyFields','dailyMissing'],['monthly','monthFields','monthMissing']])if(encodeTable(archive,rows,fields,missing,label))archiveEncoded=true;
  if(archive.history!==undefined&&archive.history!==null){if(!object(archive.history))throw TypeError(label+'.history must be an object');for(const [rows,fields,missing]of [['daily','dailyFields','dailyMissing'],['monthly','monthFields','monthMissing'],['operatingDaily','operatingFields','operatingMissing'],['operatingMonthly','operatingMonthFields','operatingMonthMissing'],['registrationMonths','registrationFields','registrationMissing'],['sources','sourceFields','sourceMissing'],['operatingSources','operatingSourceFields','operatingSourceMissing']])if(encodeTable(archive.history,rows,fields,missing,label+'.history'))archiveEncoded=true;}
 };
 const aliases={};
 if(result.competitorArchives!==undefined&&result.competitorArchives!==null){
  if(!object(result.competitorArchives)||!Array.isArray(result.competitorArchives.platforms))throw TypeError('competitorArchives.platforms must be an array');
  const owned=result.competitorArchives.platforms.filter(a=>a?.platform==='o8'),own=owned.length===1?owned[0]:null;
  if(own&&object(result.competitorArchive)&&JSON.stringify(own)===JSON.stringify(result.competitorArchive)){aliases.competitorArchive='o8';delete result.competitorArchive;}
  result.competitorArchives.platforms.forEach((a,i)=>encodeArchive(a,'competitorArchives.platforms['+i+']'));
 }
 if(result.competitorArchive!==undefined&&result.competitorArchive!==null)encodeArchive(result.competitorArchive,'competitorArchive');
 if(archiveEncoded||detailsEncoded||channelsEncoded||resourceRowsEncoded||matrixEncoded||stringTuplesEncoded||Object.keys(aliases).length){
  // Older dictionary decoders validate this known table, and reject this new
  // encoding marker before touching archive values they do not know to decode.
  let guard=result.cohorts?.find(c=>object(c?.rows)&&c.rows.encoding==='column-dictionary-v1')?.rows??(result.machines?.rows?.encoding==='column-dictionary-v1'?result.machines.rows:null)??result.payments?.months?.find(m=>m?.payers?.encoding==='column-dictionary-v1')?.payers;
  const versionThree=channelsEncoded||resourceRowsEncoded||stringTuplesEncoded,versionTwo=detailsEncoded||matrixEncoded||versionThree,metadata={format:'operations-archive-columns',version:versionThree?3:versionTwo?2:1,aliases};
  if(!guard){
   if(versionTwo){const hadOwn=Object.hasOwn(result,'machines'),hadObject=object(result.machines);metadata.syntheticMachineGuard={mode:'rows-only',hadOwn,hadObject,...(hadObject?{hadRows:Object.hasOwn(result.machines,'rows'),...(Object.hasOwn(result.machines,'rows')?{rowsValue:result.machines.rows}:{})}:hadOwn?{value:result.machines}:{})};if(!hadObject)result.machines={};result.machines.rows={encoding:'column-dictionary-v1',length:0,columns:[]};result.machines.rowFields=[];}
   else{metadata.syntheticMachineGuard={hadOwn:Object.hasOwn(result,'machines'),...(Object.hasOwn(result,'machines')?{value:result.machines}:{})};result.machines={rows:{encoding:'column-dictionary-v1',length:0,columns:[]},rowFields:[]};}
   guard=result.machines.rows;
  }
  guard.encoding=versionThree?'column-dictionary-channels-v1':versionTwo?'column-dictionary-details-v1':'column-dictionary-archive-v1';result.archiveWire=metadata;
 }
 return result;
}
