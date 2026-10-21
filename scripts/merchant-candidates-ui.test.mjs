import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import {analyzeGiftReports} from './merchant-candidates.mjs';
import {MERCHANT_IDENTITY_REGISTRY} from './merchant-identities.mjs';

const app=await fs.readFile(new URL('../app/app.js',import.meta.url),'utf8');
const source=await fs.readFile(new URL('../app/merchant-candidates.js',import.meta.url),'utf8');
const prefix=app.slice(0,app.indexOf('function daily('));
const ownPlatforms=Object.keys(MERCHANT_IDENTITY_REGISTRY.platforms).map(key=>({key}));
const header=['贈禮AID','贈禮暱稱','對象AID','對象暱稱','贈禮總金額','差額'];
function report(platform,complete=true){
 const registry=MERCHANT_IDENTITY_REGISTRY.platforms[platform],account=registry.accounts[0];
 const rows=[[account.aid,'來源暱稱',platform+'-player','一般會員','100','60'],[platform+'-player','一般會員',account.aid,'來源暱稱','40','-60']];
 return{file:`gift-rank-${platform}-2026-10-01_2026-10-19.json`,data:{platform,from:'2026-10-01',through:'2026-10-19',capturedAt:'2026-10-20T10:00:00Z',sourceUrl:'https://'+registry.host+'/statements/giving',complete,totalRows:rows.length,header,rows}};
}
function render(data,platform,month='2026-10'){
 const context=vm.createContext({payload:{platforms:ownPlatforms,merchantCandidates:data}});
 vm.runInContext(prefix+'\nD=payload;\n'+source,context);return vm.runInContext(`merchantCandidatesPanel(${JSON.stringify(platform)},${JSON.stringify(month)})`,context);
}

test('all eight newly confirmed names and string AIDs render in a separate identity section',()=>{
 const data=analyzeGiftReports(['rd','lucky','bo'].map(p=>report(p)));
 for(const platform of ['rd','lucky','bo']){
  const html=render(data,platform),identity=html.slice(0,html.indexOf('<h2>幣商候選觀測</h2>'));
  assert(html.indexOf('<h2>已確認幣商</h2>')<html.indexOf('<h2>幣商候選觀測</h2>'));
  for(const account of MERCHANT_IDENTITY_REGISTRY.platforms[platform].accounts){assert(identity.includes(account.aid));assert(identity.includes(account.nickname));}
  assert(identity.includes('使用者明確確認'));assert(identity.includes('2026-10-20'));assert(identity.includes('2026-10-01 — 2026-10-19'));assert(identity.includes('2026-10-20T10:00:00Z'));assert(identity.includes('gift-rank-'+platform));
  assert(identity.includes('<td>40.00</td><td>100.00</td>'));assert(identity.includes('<td>0.00</td><td>0.00</td>'),'complete report may confirm no activity as zero');assert(identity.includes('帳號收贈量不是平台營收'));
 }
});
test('incomplete or invalid sources keep confirmed identities but show unknown complete amounts',()=>{
 const data=analyzeGiftReports([report('bo',false)]),group=data.groups[0];
 assert.equal(group.complete,false);assert(group.confirmedMerchants.every(c=>c.in===null&&c.out===null));
 const html=render(data,'bo'),identity=html.slice(0,html.indexOf('<h2>幣商候選觀測</h2>'));
 assert(identity.includes('測試帳號10'));assert(identity.includes('<td>—</td><td>—</td>'));assert(!identity.includes('<td>0.00</td><td>0.00</td>'));assert(!identity.includes('<td>40.00</td><td>100.00</td>'));assert(identity.includes('排行未完整'));
 group.complete=true;group.validation.valid=false;for(const c of group.confirmedMerchants){c.in=40;c.out=100;}
 const invalid=render(data,'bo').split('<h2>幣商候選觀測</h2>')[0];assert(invalid.includes('<td>—</td><td>—</td>'));assert(!invalid.includes('<td>40.00</td><td>100.00</td>'));
});
test('original three platforms use the same confirmation display and per-account amount coverage',()=>{
 const data=analyzeGiftReports(['win','qz','song'].map(p=>report(p)));
 for(const platform of ['win','qz','song']){const identity=render(data,platform).split('<h2>幣商候選觀測</h2>')[0];for(const a of MERCHANT_IDENTITY_REGISTRY.platforms[platform].accounts)assert(identity.includes(a.aid));assert(identity.includes('使用者明確確認'));}
 const c=data.groups.find(g=>g.platform==='win').confirmedMerchants[0];c.amountsComplete=false;
 const identity=render(data,'win').split('<h2>幣商候選觀測</h2>')[0];assert(identity.includes('<td>—</td><td>—</td>'));assert(!identity.includes('<td>40.00</td><td>100.00</td>'));
});
test('confirmed accounts do not reappear among candidates; unconfirmed and competitor identities stay candidates',()=>{
 const data=analyzeGiftReports([report('bo')]),g=data.groups[0],confirmed=g.confirmedMerchants[0];
 const candidate={aid:'unconfirmed-1',nickname:'候選金庫',level:'high',in:99,out:88,uniqueCounterparties:20,bidirectionalCounterparties:8,concentration:{largestCounterpartyShare:.1},evidence:['觀測量線索'],verifiedMerchant:false};
 g.candidates=[candidate,{...confirmed,verifiedMerchant:false}];
 const html=render(data,'bo'),candidateSection=html.slice(html.indexOf('<h2>幣商候選觀測</h2>'));
 assert(candidateSection.includes('候選金庫'));assert(!candidateSection.includes(confirmed.aid));assert(candidateSection.includes('尚未確認幣商身分；不納入營收'));
 const competitor={...g,platform:'aos',confirmedMerchants:[],candidates:[candidate]};
 const chtml=render({groups:[competitor]},'aos');assert(!chtml.includes('<h2>已確認幣商</h2>'));assert(chtml.includes('候選金庫'));assert(chtml.includes('不納入營收'));
});
test('lookup respects platform and month; display strings are escaped and missing dates are not fabricated',()=>{
 const data=analyzeGiftReports([report('bo')]),g=data.groups[0],c=g.confirmedMerchants[0];c.nickname='<img src=x>';c.merchantIdentityEvidence='<script>bad</script>';c.merchantIdentityConfirmedOnTaipei=null;
 const html=render(data,'bo');assert(html.includes('&lt;img src=x&gt;'));assert(html.includes('&lt;script&gt;bad&lt;/script&gt;'));assert(!html.includes('<script>bad'));assert(html.includes('確認日期待補'));
 assert(!render(data,'rd').includes(c.aid));assert(!render(data,'bo','2026-09').includes(c.aid));assert(render(data,'bo','2026-09').includes('尚無此期間的候選來源'));
});
