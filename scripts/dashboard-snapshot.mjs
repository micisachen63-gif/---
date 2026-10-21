import fs from 'node:fs/promises';
import path from 'node:path';
import {gzipSync, gunzipSync} from 'node:zlib';

// The snapshot stores the original UTF-8 file bytes, not reserialized data.
// gzipSync omits filename metadata and uses a zero timestamp, so equal bytes
// produce equal snapshots on repeated builds.
export function gzipDashboardBytes(bytes) {
 return gzipSync(bytes,{level:9});
}

function parseDashboard(bytes) {
 const text=new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(bytes);
 const data=JSON.parse(text);
 if(data===null||typeof data!=='object'||Array.isArray(data))throw new TypeError('Dashboard JSON must contain an object');
 return data;
}

export async function prepareDashboardSnapshot(root) {
 const fullPath=path.join(root,'data/dashboard.json');
 const snapshotPath=path.join(root,'data/dashboard-snapshot.json.gz');
 let bytes,source='json';
 try {bytes=await fs.readFile(fullPath);}
 catch(error) {
  // An invalid or unreadable existing JSON file must never use stale fallback.
  if(error.code!=='ENOENT')throw error;
  bytes=gunzipSync(await fs.readFile(snapshotPath));
  source='gzip';
 }
 const data=parseDashboard(bytes);
 if(source==='gzip')await fs.writeFile(fullPath,bytes);
 const snapshot=gzipDashboardBytes(bytes);
 await fs.writeFile(snapshotPath,snapshot);
 return {data,bytes,source,fullPath,snapshotPath};
}
