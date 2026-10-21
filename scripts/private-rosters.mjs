import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const synthetic=process.env.OPERATIONS_SYNTHETIC_FIXTURES==='1';
const file=synthetic?path.join(root,'config/rosters.synthetic.json'):(process.env.OPERATIONS_PRIVATE_ROSTERS||path.join(root,'private/rosters.json'));
let value;try{value=JSON.parse(fs.readFileSync(file,'utf8'));}catch{throw Error('PRIVATE_ROSTERS_REQUIRED: configure OPERATIONS_PRIVATE_ROSTERS with the local private registry; never publish it.');}
if(value.schema!==1||!value.owned?.platforms||!value.candidates||!value.excludedRoles)throw Error('PRIVATE_ROSTERS_INVALID');
function freezeTree(node){if(node&&typeof node==='object'){for(const child of Object.values(node))freezeTree(child);Object.freeze(node);}return node;}
export const PRIVATE_ROSTERS=freezeTree(value);
export const USING_SYNTHETIC_ROSTERS=synthetic;
