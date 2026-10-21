import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {DETAIL_PLATFORM_HOSTS,validDetailDate} from './detail-source-selection.mjs';
import {currentTaipeiDay,parseBackendNumber} from './backend-metrics.mjs';

const NAMES={win:'贏麻了',qz:'茄子',song:'爽爆',rd:'紅鑽',lucky:'來好運',bo:'來博',o8:'發又發',aos:'黑桃A',fcc:'財哥',cgb:'超吉爆',goldfun:'金來快',o9:'黑狗兄'};
const PRIMARY=['禮包兌換','創角金幣','商城金幣','固定系統','期限活動','儲值活動'],OPTIONAL_PRIMARY=['公會系統'];
const day=value=>typeof value==='string'&&Number.isFinite(Date.parse(value))?new Date(Date.parse(value)+8*3600000).toISOString().slice(0,10):null;
const dates=(from,through)=>{const out=[];if(!validDetailDate(from)||!validDetailDate(through)||from>through)return out;for(let t=Date.parse(from);t<=Date.parse(through);t+=86400000)out.push(new Date(t).toISOString().slice(0,10));return out;};
const finite=value=>typeof value==='number'&&Number.isFinite(value)&&value>=0;
const money=value=>{const n=parseBackendNumber(value);return n!==null&&n>=0?n:null;};
const safeRef=s=>({file:s.file,from:s.from,through:s.through,capturedAt:s.capturedAt,sourceUrl:s.sourceUrl,complete:s.complete,issues:s.issues});
function context(file,raw,kind,asOf){
 const m=new RegExp(`^${kind}-([a-z0-9]+)-(\\d{4}-\\d{2}-\\d{2})_(\\d{4}-\\d{2}-\\d{2})-asof-(\\d{4})(\\d{2})(\\d{2})\\.json$`).exec(file),platform=m?.[1],from=m?.[2],through=m?.[3],captureDate=day(raw?.capturedAt),issues=[];
 if(!m||!DETAIL_PLATFORM_HOSTS[platform]||raw?.platform!==platform||raw?.from!==from||raw?.through!==through||!dates(from,through).length)issues.push('source_filename_or_period_invalid');
 if(!captureDate||captureDate!==`${m?.[4]}-${m?.[5]}-${m?.[6]}`||captureDate>asOf||through>=captureDate||through>=asOf||raw?.currentDayPartial===true)issues.push('source_not_closed_at_capture');
 let sourceUrl=null;try{const u=new URL(raw.sourceUrl);if(u.protocol!=='https:'||u.host!==DETAIL_PLATFORM_HOSTS[platform]||u.pathname.replace(/\/$/,'')!==(kind==='promotion-flow'?'/statements/moneyflow':'/statements/deposit-statements')||u.username||u.password||u.search||u.hash)issues.push('untrusted_report_source');else sourceUrl=raw.sourceUrl;}catch{issues.push('untrusted_report_source');}
 const q=raw?.queryProof;if(q?.verified!==true||q?.freshResultVerified!==true||q?.selectedFrom?.slice(0,10)!==from||q?.selectedThrough?.slice(0,10)!==through)issues.push('selected_dates_or_freshness_not_verified');
 if(raw?.permissionDenied===true||raw?.access?.allowed===false)issues.push('permission_denied');
 if(raw?.complete!==true||raw?.validation?.valid===false)issues.push('source_incomplete');
 return{file,platform,from,through,capturedAt:day(raw?.capturedAt)?raw.capturedAt:null,sourceUrl,issues};
}
function columnSummary(table,labels,period){
 const header=table?.header,rows=table?.rows,issues=[],expected=dates(period.from,period.through),seen=new Set(),totals=new Map(),di=Array.isArray(header)?header.indexOf('日期'):-1;
 const selected=labels.filter(label=>(Array.isArray(header)?header:[]).includes(label));if(!selected.length)return{categories:[],issues:[]};
 if(di<0||!Array.isArray(rows)||table?.validation?.valid!==true)return{categories:[],issues:['activity_table_not_verified']};
 for(const label of selected){if(header.filter(h=>h===label).length!==1)issues.push('activity_duplicate_column');totals.set(label,0);}
 for(const row of rows){const date=row?.[di];if(['加總','總和','總計','合計','平均'].includes(date))continue;if(!validDetailDate(date)||date<period.from||date>period.through){issues.push('activity_row_outside_period');continue;}if(seen.has(date))issues.push('activity_duplicate_date');seen.add(date);for(const label of selected){const amount=money(row[header.indexOf(label)]);if(amount===null)issues.push('activity_amount_unknown');else totals.set(label,totals.get(label)+amount);}}
 if(expected.some(d=>!seen.has(d))||seen.size!==expected.length)issues.push('activity_daily_dates_missing');
 for(const [label,total] of totals){const proof=table.validation.columnTotals?.[label];if(proof!==undefined&&(money(proof)===null||Math.abs(money(proof)-total)>.011))issues.push('activity_column_total_mismatch');const footer=rows.find(r=>['加總','總和','總計','合計'].includes(r[di]));if(footer&&(money(footer[header.indexOf(label)])===null||Math.abs(money(footer[header.indexOf(label)])-total)>.011))issues.push('activity_footer_total_mismatch');}
 return{categories:[...totals].map(([name,coins])=>({name,coins})),issues:[...new Set(issues)]};
}
export function parsePromotionFlow(file,raw,{asOf=currentTaipeiDay()}={}){
 const s=context(file,raw,'promotion-flow',asOf),categories=[],subCategories=[],seen=new Set(),detailIssues=[];
 if(raw?.tab!=='總金流查詢')s.issues.push('activity_query_tab_not_verified');
 for(const table of Array.isArray(raw?.tables)?raw.tables:[]){const primary=table.layer==='primary',detail=table.layer==='detail'&&[...PRIMARY,...OPTIONAL_PRIMARY].includes(table.parentKey);if(!primary&&!detail)continue;const labels=primary?[...PRIMARY,...OPTIONAL_PRIMARY]:(Array.isArray(table.header)?table.header.filter(h=>h!=='日期'):[]),parsed=columnSummary(table,labels,s);(primary?s.issues:detailIssues).push(...parsed.issues);if(parsed.issues.length)continue;for(const c of parsed.categories){const id=(primary?'primary:':'detail:'+table.parentKey+':')+c.name;if(seen.has(id))(primary?s.issues:detailIssues).push('activity_duplicate_category');seen.add(id);(primary?categories:subCategories).push({...c,...(!primary?{parentKey:table.parentKey}:{})});}}
 if(PRIMARY.some(label=>!categories.some(c=>c.name===label)))s.issues.push('primary_activity_categories_missing');
 s.issues=[...new Set(s.issues)];const complete=!s.issues.length;
 const failedTabs=(raw?.tabOutcomes??[]).filter(t=>t.ok===false).map(t=>({tab:['固定系統產出','期間活動系統產出','儲值活動','公會系統'].includes(t.tab)?t.tab:'其他子類',code:'activity_detail_source_missing'})),detailsComplete=complete&&raw?.partial!==true&&!detailIssues.length&&!failedTabs.length&&subCategories.length>0;
 return{...s,complete,partial:raw?.partial===true||detailIssues.length>0||failedTabs.length>0,validation:{valid:complete,issues:s.issues},unit:'原始金幣',categories:complete?categories:[],subCategories:complete?subCategories:[],totalCoins:complete?categories.reduce((n,c)=>n+c.coins,0):null,detailAvailable:complete&&subCategories.length>0,detailsComplete,detailGaps:[...failedTabs,...[...new Set(detailIssues)].map(code=>({tab:'子類',code}))],sourceFiles:[file],definition:'主要活動類發放金幣加總（含來源可見公會系統）；各子類另列，不和父項重複相加。機台出分、收入與餘額不納活動總量；不是現金成本、成功購買筆數或增量營收。'};
}
function fullOrderTable(raw){
 const rows=raw?.rows,proof=raw?.tableProof,p=raw?.paginationProof,n=raw?.totalRows;
 if(!Array.isArray(rows)||!Number.isSafeInteger(n)||n<0||n!==rows.length)return false;
 if(proof?.mode==='unpaginated_full_table')return proof.noPaginationObserved===true&&proof.observedRows===n;
 if(!p||!Number.isSafeInteger(p.pageSize)||p.pageSize<=0||p.totalRows!==n||!Array.isArray(p.pages)||p.pages.length!==Math.max(1,Math.ceil(n/p.pageSize)))return false;
 const seen=new Set();return p.pages.every((page,i)=>{const slice=rows.slice(i*p.pageSize,(i+1)*p.pageSize),hash=createHash('sha256').update(JSON.stringify(slice)).digest('hex'),valid=page.page===i+1&&page.rowCount===Math.min(p.pageSize,Math.max(0,n-i*p.pageSize))&&page.selectedPageVerified===true&&page.rowSha256===hash&&(!slice.length||!seen.has(hash));seen.add(hash);return valid;});
}
export function parsePackageOrders(file,raw,{asOf=currentTaipeiDay()}={}){
 const s=context(file,raw,'package-orders',asOf),orders=new Map();
 const productFilter=typeof raw?.queryProof?.product==='string'?raw.queryProof.product:null,statusFilter=raw?.queryProof?.successStatus;
 if(raw?.tab!=='使用日期查詢'||raw?.queryProof?.filtersVerified!==true||!productFilter||!['成功','全部'].includes(statusFilter))s.issues.push('order_filters_not_verified');
 if(raw?.identityProof?.reliable!==true||raw?.identityProof?.method!=='source_order_id_sha256')s.issues.push('reliable_order_identity_missing');
 if(!fullOrderTable(raw))s.issues.push('order_table_completeness_not_verified');
 if(Array.isArray(raw?.rows)&&raw.rows.length===0&&raw?.queryProof?.emptyResultVerified!==true)s.issues.push('empty_order_result_unverified');
 for(const row of Array.isArray(raw?.rows)?raw.rows:[]){const fingerprint=row?.orderFingerprint,aid=typeof row?.aid==='string'?row.aid.trim():null,paid=money(row?.paidAmount),name=typeof row?.packageName==='string'?row.packageName.trim():null,status=row?.status;
  if(!/^[a-f0-9]{64}$/.test(fingerprint??'')||!aid||!name||paid===null||!['success','failed','cancelled','pending','refunded'].includes(status)){s.issues.push('order_projection_or_status_invalid');continue;}
  const productType=typeof row?.productType==='string'?row.productType:productFilter===name?productFilter:null,typedName=productType===productFilter&&(name===productType||productType==='一次儲值包'&&name.startsWith('一次儲值包'));
  if(productFilter!=='全部'&&!typedName||statusFilter==='成功'&&status!=='success')s.issues.push('order_row_outside_verified_filters');
  const record={aid,packageName:name,productType,paidAmount:paid,status},old=orders.get(fingerprint);if(old&&JSON.stringify(old)!==JSON.stringify(record))s.issues.push('order_identity_conflict');else orders.set(fingerprint,record);
 }
 s.issues=[...new Set(s.issues)];const complete=!s.issues.length,success=[...orders.values()].filter(o=>o.status==='success'),byPackage=new Map();for(const order of success){const value=byPackage.get(order.packageName)??{name:order.packageName,successfulOrders:0,paidCash:0,ids:new Set(),paidIds:new Set()};value.successfulOrders++;value.paidCash+=order.paidAmount;value.ids.add(order.aid);if(order.paidAmount>0)value.paidIds.add(order.aid);byPackage.set(order.packageName,value);}
 return{...s,complete,validation:{valid:complete,issues:s.issues},productFilter,allProductTypes:productFilter==='全部',successfulOrders:complete?success.length:null,uniqueBuyerAIDs:complete?new Set(success.map(o=>o.aid)).size:null,uniquePaidAIDs:complete?new Set(success.filter(o=>o.paidAmount>0).map(o=>o.aid)).size:null,paidCash:complete?success.reduce((n,o)=>n+o.paidAmount,0):null,observedRows:Array.isArray(raw?.rows)?raw.rows.length:null,uniqueOrders:complete?orders.size:null,duplicateRows:complete?raw.rows.length-orders.size:null,byPackage:complete?[...byPackage.values()].map(({ids,paidIds,...values})=>({...values,uniqueBuyerAIDs:ids.size,uniquePaidAIDs:paidIds.size})):[],sourceFiles:[file],definition:'只代表標示商品篩選範圍。依可靠訂單識別去重後，只統計成功訂單、購買AID去重與實付金額；失敗、取消、待付款與退款不計。優惠金幣不當購買筆數或現金。'};
}
const latest=list=>[...list].sort((a,b)=>Date.parse(b.capturedAt)-Date.parse(a.capturedAt)||b.through.localeCompare(a.through))[0]??null;
const exact=(s,p)=>s.from===p.from&&s.through===p.through;
function defaultPeriod(asOf){const through=new Date(Date.parse(asOf)-86400000).toISOString().slice(0,10),from=through.slice(0,7)+'-01',prev=new Date(from);prev.setUTCMonth(prev.getUTCMonth()-1);const previousFrom=prev.toISOString().slice(0,7)+'-01',last=new Date(Date.UTC(prev.getUTCFullYear(),prev.getUTCMonth()+1,0)).getUTCDate();return{current:{from,through},previous:{from:previousFrom,through:previousFrom.slice(0,8)+String(Math.min(last,Number(through.slice(8)))).padStart(2,'0')}};}
export async function buildPromotionPackageData(live,{asOf=currentTaipeiDay(),period=null,platforms=Object.keys(DETAIL_PLATFORM_HOSTS)}={}){
 const parsed=[],unreadable=[],scope=period??defaultPeriod(asOf);for(const file of (await fs.readdir(live)).filter(f=>/^(promotion-flow|package-orders)-[a-z0-9]+-.*-asof-\d{8}\.json$/.test(f)).sort())try{const raw=JSON.parse((await fs.readFile(path.join(live,file),'utf8')).replace(/^\uFEFF/,''));parsed.push({kind:file.startsWith('promotion-flow-')?'promotions':'packages',...file.startsWith('promotion-flow-')?parsePromotionFlow(file,raw,{asOf}):parsePackageOrders(file,raw,{asOf})});}catch{unreadable.push({file,code:'source_json_unreadable'});}
 const groups=platforms.filter(key=>DETAIL_PLATFORM_HOSTS[key]).map(platform=>{const gaps=[],out={platform,name:NAMES[platform]??platform,period:scope.current,previousPeriod:scope.previous};for(const kind of ['promotions','packages']){const sources=parsed.filter(s=>s.platform===platform&&s.kind===kind),valid=sources.filter(s=>s.complete),periods=[...new Map(valid.sort((a,b)=>Date.parse(a.capturedAt)-Date.parse(b.capturedAt)).map(s=>[s.from+'_'+s.through,s])).values()],current=latest(periods.filter(s=>exact(s,scope.current))),previous=latest(periods.filter(s=>exact(s,scope.previous))),comparable=!!current&&!!previous&&dates(current.from,current.through).length===dates(previous.from,previous.through).length&&(kind==='packages'?current.productFilter===previous.productFilter:JSON.stringify(current.categories.map(c=>c.name).sort())===JSON.stringify(previous.categories.map(c=>c.name).sort()));for(const p of [scope.current,scope.previous])if(!periods.some(s=>exact(s,p)))gaps.push({module:kind,...p,code:(sources.find(s=>exact(s,p))?.issues?.includes('permission_denied')?'permission_denied':sources.find(s=>exact(s,p))?.issues?.[0])??'source_missing'});out[kind]={current,previous,periods,comparable,sources:sources.map(safeRef)};}return{...out,gaps};});
 return{schema:1,asOf,period:scope.current,previousPeriod:scope.previous,platforms:groups,readErrors:unreadable,definitions:{scope:'各站只採自己的已核驗來源。當前與前月同期日期各自完整才比較；舊19日資料僅來源參照，不當20日。',activity:'發放量為原金幣；主類與子類不重複加總，不推定現金成本或ROI。',orders:'成功訂單以可靠交易識別去重；只有金幣優惠表、缺完整表或權限不足時保留未知。'}};
}
