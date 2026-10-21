import {gzipSync} from 'node:zlib';
import {createHash} from 'node:crypto';
import {encodeDashboardPayload} from './wire-data.mjs';

export const DASHBOARD_TRANSPORT_LIMITS=Object.freeze({decodedBytes:128*1024*1024,decodedChars:128*1024*1024,compressedBytes:11*1024*1024,requestChars:15000000});
const clone=value=>JSON.parse(JSON.stringify(value));
export function encodeDashboardTransport(data){
 if(!data||data.schema!==1||!Number.isFinite(Date.parse(data.generatedAt))||!Array.isArray(data.platforms)||data.platforms.length!==6||!Array.isArray(data.monthly))throw TypeError('invalid dashboard transport metadata');
 const wire=encodeDashboardPayload(data),text=JSON.stringify(wire),bytes=Buffer.from(text,'utf8');
 if(text.length>DASHBOARD_TRANSPORT_LIMITS.decodedChars||bytes.length>DASHBOARD_TRANSPORT_LIMITS.decodedBytes)throw RangeError('dashboard decoded transport limit exceeded');
 const compressed=gzipSync(bytes,{level:9});if(compressed.length>DASHBOARD_TRANSPORT_LIMITS.compressedBytes)throw RangeError('dashboard compressed transport limit exceeded');
 const result={schema:wire.schema,generatedAt:wire.generatedAt,platforms:clone(wire.platforms),monthly:clone(wire.monthly),archiveWire:{format:'operations-archive-columns',version:4,aliases:{}},transport:{format:'operations-dashboard-transport',version:1,encoding:'gzip-base64',rawBytes:bytes.length,rawChars:text.length,compressedBytes:compressed.length,sha256:createHash('sha256').update(bytes).digest('hex')},payload:compressed.toString('base64')};
 if(JSON.stringify(result).length>DASHBOARD_TRANSPORT_LIMITS.requestChars)throw RangeError('dashboard request character limit exceeded');
 return result;
}
