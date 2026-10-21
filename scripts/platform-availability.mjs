import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {readArchiveJson} from './o8-archive-store.mjs';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
export async function loadPlatformAvailability(){return readArchiveJson(path.join(root,'config/platform-availability.json'),{schema:1,platforms:{}});}
export function platformCollectionPaused(platform,availability){return availability?.platforms?.[platform]?.state==='temporarily_unavailable';}
