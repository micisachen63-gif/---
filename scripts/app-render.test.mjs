import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import {encodeDashboardPayload} from './wire-data.mjs';
import {encodeDashboardTransport} from './transport-data.mjs';
import {webcrypto} from 'node:crypto';

// This is a DOM contract stub, not a browser renderer. It exercises the actual
// render(), route selection and content-binding code using dashboard.json.
// It intentionally does not invent missing elements: querySelector returns
// null when a route has not rendered the requested ID.
function stubDocument(){
 const nodes=new Set(),ids=new Map();
 const decode=s=>String(s).replaceAll('&quot;','"').replaceAll('&#39;',"'").replaceAll('&lt;','<').replaceAll('&gt;','>').replaceAll('&amp;','&');
 const descendant=(node,parent)=>{for(let n=node.owner;n;n=n.owner)if(n===parent)return true;return false;};
 const matches=(node,selector)=>{
  if(selector.startsWith('#'))return node.id===selector.slice(1);
  const attr=selector.match(/^\[([^=\]]+)(?:=["']?([^\]"']*)["']?)?\]$/);
  if(attr)return node.attributes.has(attr[1])&&(attr[2]===undefined||node.attributes.get(attr[1])===attr[2]);
  return node.tagName===selector.toLowerCase();
 };
 function removeChildren(parent){for(const node of [...nodes])if(descendant(node,parent)){nodes.delete(node);if(node.id&&ids.get(node.id)===node)ids.delete(node.id);}}
 function element(tag='div',attributes=new Map(),owner=null){
  let html='';
  const node={tagName:tag.toLowerCase(),attributes,owner,dataset:{},id:attributes.get('id')||'',textContent:'',value:attributes.get('value')||'',className:attributes.get('class')||'',disabled:attributes.has('disabled'),hidden:attributes.has('hidden'),open:false,style:{},onclick:null,oninput:null,onchange:null,onkeydown:null,
   get innerHTML(){return html;},set innerHTML(value){html=String(value??'');removeChildren(this);const stack=[this],voidTags=new Set(['area','base','br','col','embed','hr','img','input','link','meta','param','source','track','wbr']);for(const match of html.matchAll(/<(\/?)([a-z][\w-]*)\b([^>]*)>/gi)){const tag=match[2].toLowerCase();if(match[1]){const index=stack.findLastIndex(n=>n.tagName===tag);if(index>0)stack.length=index;continue;}const attrs=new Map();for(const a of match[3].matchAll(/([\w:-]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g))attrs.set(a[1],decode(a[2]??a[3]??a[4]??''));const child=element(tag,attrs,stack.at(-1));if(!voidTags.has(tag)&&!match[3].endsWith('/'))stack.push(child);}},
   querySelector(selector){return [...nodes].find(n=>descendant(n,this)&&matches(n,selector))||null;},querySelectorAll(selector){return [...nodes].filter(n=>descendant(n,this)&&matches(n,selector));},
   setAttribute(name,value){this.attributes.set(name,String(value));},getAttribute(name){return this.attributes.get(name)??null;},addEventListener(){},
   showModal(){this.open=true;},close(){this.open=false;},click(){return this.onclick?.({target:this});},appendChild(){},remove(){nodes.delete(this);if(this.id)ids.delete(this.id);}
  };
  for(const [name,value] of attributes)if(name.startsWith('data-'))node.dataset[name.slice(5).replace(/-([a-z])/g,(_,c)=>c.toUpperCase())]=value;
  nodes.add(node);if(node.id)ids.set(node.id,node);return node;
 }
 const rootIds=['products','productName','title','subtitle','year','month','cutoff','sections','freshness','updatedAt','notices','content','reload','refreshData','refreshStatus','closeDetail','detail','detailTitle','detailBody'];
 for(const id of rootIds)element('div',new Map([['id',id]]));
 return{querySelector(selector){if(selector.startsWith('#'))return ids.get(selector.slice(1))||null;return [...nodes].find(n=>matches(n,selector))||null;},querySelectorAll(selector){return [...nodes].filter(n=>matches(n,selector));},createElement:element,body:{appendChild(){}},getElementById:id=>ids.get(id)||null};
}

const root=new URL('../',import.meta.url);
const dashboard=JSON.parse(await fs.readFile(new URL('data/dashboard.json',root),'utf8'));
const buildSource=await fs.readFile(new URL('scripts/build.mjs',root),'utf8');
const buildModules=/for\(const file of (\[[^\]]+\])\)/.exec(buildSource)?.[1];
assert.ok(buildModules,'smoke must read the actual build module order');
const moduleOrder=['app.js',...[...buildModules.matchAll(/'([^']+)'/g)].map(m=>m[1])];
const coinPolicy=JSON.parse(await fs.readFile(new URL('config/merchant-rates.json',root),'utf8'));
const scripts=await Promise.all(moduleOrder.map(async name=>({name,source:await fs.readFile(new URL('app/'+name,root),'utf8')})));

async function harness({wire=false,transport=false}={}){
 const document=stubDocument(),payload=transport?encodeDashboardTransport(dashboard):wire?encodeDashboardPayload(dashboard):structuredClone(dashboard),fetchCalls=[];
 const context=vm.createContext({COIN_CONVERSION_POLICY:coinPolicy,document,console,URL,Blob,TextEncoder,TextDecoder,DecompressionStream,crypto:webcrypto,atob,Uint8Array,setTimeout,clearTimeout,setInterval,clearInterval,navigator:{clipboard:{async writeText(){}}},fetch:async url=>{fetchCalls.push(url);assert.ok(['/api/data','/api/access'].includes(url),'render smoke test must not issue writes or unexpected requests');if(url==='/api/access')return{ok:true,status:200,async json(){return{canRefresh:false,readOnly:true};}};return{ok:true,status:200,async json(){return payload;}};}});
 for(const script of scripts)vm.runInContext(script.source,context,{filename:script.name,timeout:10000});
 // Await the same initial load path used by the real app after all view
 // definitions have been installed. No route function is mocked/replaced.
 await vm.runInContext('load()',context,{timeout:10000});
 assert.doesNotMatch(document.querySelector('#content').innerHTML,/資料暫時無法載入/,'initial data load must successfully render');
 return{context,document,fetchCalls};
}
function renderRoute(h,product,month,section){
 h.context.route={product,month,section};
 vm.runInContext('Object.assign(state,route,{year:2026,search:"",filter:"all",page:1,channel:""});render();',h.context,{timeout:10000});
 const html=h.document.querySelector('#content').innerHTML;
 assert.ok(html.length>20,'route should render content');
 assert.doesNotMatch(html,/NaN|(?:[>="\s])(?:undefined|Infinity)(?:[<"\s])/,'route must not leak invalid numbers or undefined values');
 return html;
}

const ownSections=['overview','monthly','new','retention','structure','merchant','activities','packages','wash','analysis','sources','machines'];
const aggregateSections=['overview','monthly','sources','machines'];
const months=['2026-09','2026-10','2026-11'];
const products=[...dashboard.platforms.map(p=>({...p,kind:'own'})),...dashboard.competitors.map(p=>({...p,kind:'competitor'})),{key:'all',name:'六站總覽',kind:'all'}];

test('channel quality view keeps registration visible without a payment source and filters unknown separately',async()=>{
 const h=await harness();
 vm.runInContext(`D.channelsByPlatform={platforms:[{platform:'lucky',periods:[{month:'2026-10',from:'2026-10-01',through:'2026-10-20',registrationComplete:true,paymentComplete:false,complete:false,registrations:2,firstPayers:null,firstPaidCash:null,conversionRate:null,channels:[{channel:'渠道<甲>',registrations:2,firstPayers:null,firstPaidCash:null,conversionRate:null}],sources:[]}],players:[{platform:'lucky',month:'2026-10',cutoff:'2026-10-20',aid:'test-a',name:'甲',channel:'渠道<甲>',created:'2026-10-01',firstperiodCash:null,initialUntouched:null},{platform:'lucky',month:'2026-10',cutoff:'2026-10-20',aid:'test-b',name:'乙',channel:'渠道<甲>',created:'2026-10-02',firstperiodCash:null,initialUntouched:null}]}]};`,h.context);
 const html=renderRoute(h,'lucky','2026-10','new');
 assert.match(html,/渠道帶來多少人/);assert.match(html,/註冊已核對 · 官儲待核對/);assert.match(html,/渠道&lt;甲&gt;/);assert.doesNotMatch(html,/NaN|Infinity|已確認無效率[^]*?0\.0%/);
 h.document.querySelector('#newStatusFilter').value='unpaid';h.document.querySelector('#newStatusFilter').onchange({target:{value:'unpaid'}});
 assert.doesNotMatch(h.document.querySelector('#newRows').innerHTML,/test-a|test-b/,'unknown payment cannot be classified as unpaid');
 h.document.querySelector('#newStatusFilter').onchange({target:{value:'qualityUnknown'}});
 assert.match(h.document.querySelector('#newRows').innerHTML,/test-a/);assert.match(h.document.querySelector('#newRows').innerHTML,/test-b/);
});

test('channel quality filters suspected initial state independently from payment and escapes names',async()=>{
 const h=await harness();
 vm.runInContext(`D.channelsByPlatform={platforms:[{platform:'win',periods:[{month:'2026-10',from:'2026-10-01',through:'2026-10-20',registrationComplete:true,paymentComplete:true,complete:true,registrations:2,firstPayers:1,firstPaidCash:120,conversionRate:.5,quality:{invalidRate:null,invalidCount:1,invalidRate:.5,suspectedUnstartedCount:1,suspectedUnstartedRate:.5,readableCount:2,unknownCount:0},channels:[{channel:'來源',registrations:2,firstPayers:1,firstPaidCash:120,conversionRate:.5,arppu:120,rpu:60,quality:{invalidRate:null,invalidCount:1,invalidRate:.5,suspectedUnstartedCount:1,suspectedUnstartedRate:.5,readableCount:2,unknownCount:0}}],sources:[]}],players:[{platform:'win',month:'2026-10',cutoff:'2026-10-20',aid:'untouched-a',name:'<img src=x>',channel:'來源',created:'2026-10-01',firstperiodCash:0,initialUntouched:true},{platform:'win',month:'2026-10',cutoff:'2026-10-20',aid:'paid-b',name:'乙',channel:'來源',created:'2026-10-02',firstperiodCash:120,initialUntouched:false}]}]};`,h.context);
 const html=renderRoute(h,'win','2026-10','new');assert.match(html,/各渠道官儲轉化/);assert.match(html,/各渠道無效註冊率/);assert.match(html,/50\.0%/);assert.match(h.document.querySelector('#newRows').innerHTML,/&lt;img src=x&gt;/);
 const filter=h.document.querySelector('#newStatusFilter');filter.onchange({target:{value:'untouched'}});assert.match(h.document.querySelector('#newRows').innerHTML,/untouched-a/);assert.doesNotMatch(h.document.querySelector('#newRows').innerHTML,/paid-b/);
 filter.onchange({target:{value:'paid'}});assert.match(h.document.querySelector('#newRows').innerHTML,/paid-b/);assert.doesNotMatch(h.document.querySelector('#newRows').innerHTML,/untouched-a/);
});

test('dashboard fixture covers six owned platforms and every configured competitor',()=>{
 assert.equal(dashboard.platforms.length,6);for(const key of ['o8','aos','fcc','cgb'])assert.ok(dashboard.competitors.some(c=>c.key===key));
 assert.equal(new Set(products.map(p=>p.key)).size,7+dashboard.competitors.length);
 assert.ok(dashboard.monthSnapshots?.length>=60,'all six monthly backend sources must be integrated');
 for(const platform of dashboard.platforms)assert.equal((dashboard.daily?.[platform.key]||[]).filter(r=>r[0].startsWith('2026-11')).length,0,'November is intentionally empty for this smoke fixture');
});

test('retention includes merchant-only payers and never classifies unknown merchant activity as no funding',async()=>{
 const h=await harness();
 vm.runInContext(`D.payerComparisons=[];D.cohorts=[{platform:'win',previous:'2026-09',current:'2026-10',cutoff:'2026-10-20',previousMerchantCovered:true,currentMerchantCovered:false,sources:[],rows:[{aid:'cash-a',name:'官儲者',prevCash:100,currentCash:20,prevCoins:0,currentCoins:0,prevReturned:0,currentReturned:0,currentMerchantCovered:true},{aid:'buy-b',name:'只買幣',prevCash:100,currentCash:0,prevCoins:120,currentCoins:240,prevReturned:0,currentReturned:0,currentMerchantCovered:true},{aid:'sell-c',name:'仍賣幣',prevCash:100,currentCash:0,prevCoins:0,currentCoins:0,prevReturned:0,currentReturned:122,currentMerchantCovered:true},{aid:'unknown-d',name:'交易未知',prevCash:100,currentCash:0,prevCoins:null,currentCoins:null,prevReturned:null,currentReturned:null,currentMerchantCovered:false},{aid:'none-e',name:'未補入',prevCash:100,currentCash:0,prevCoins:0,currentCoins:0,prevReturned:0,currentReturned:0,currentMerchantCovered:true}],additionalMerchantOnlyRows:[{aid:'merchant-only-f',name:'前月只買幣',prevCash:0,currentCash:0,prevCoins:120,currentCoins:240,prevReturned:0,currentReturned:0,currentMerchantCovered:true}]}];`,h.context);
 const html=renderRoute(h,'win','2026-10','retention');assert.match(html,/有沒有再補入，要連幣商一起看/);assert.match(html,/前月官儲或買幣會員聯集/);assert.match(h.document.querySelector('#playerRows').innerHTML,/merchant-only-f/);
 const filter=h.document.querySelector('#playerFilter');filter.onchange({target:{value:'shift'}});let rows=h.document.querySelector('#playerRows').innerHTML;assert.match(rows,/buy-b/);assert.match(rows,/merchant-only-f/);assert.doesNotMatch(rows,/unknown-d|none-e|cash-a|sell-c/);
 filter.onchange({target:{value:'none'}});rows=h.document.querySelector('#playerRows').innerHTML;assert.match(rows,/none-e/);assert.match(rows,/sell-c/);assert.doesNotMatch(rows,/unknown-d|buy-b|merchant-only-f/);
 filter.onchange({target:{value:'sellOnly'}});rows=h.document.querySelector('#playerRows').innerHTML;assert.match(rows,/sell-c/);assert.doesNotMatch(rows,/unknown-d|none-e/);
 filter.onchange({target:{value:'merchantUnknown'}});rows=h.document.querySelector('#playerRows').innerHTML;assert.match(rows,/unknown-d/);assert.doesNotMatch(rows,/buy-b|none-e|sell-c/);
});

test('same-period two-channel view excludes first-time sellers from previous-payer no-funding attention',async()=>{
 const h=await harness();
 vm.runInContext(`D.payerComparisons=[{platform:'win',previous:'2026-09',current:'2026-10',from:'2026-10-01',through:'2026-10-20',prevFrom:'2026-09-01',prevThrough:'2026-09-20',complete:true,sources:[],rows:[{aid:'first-seller',name:'本期僅賣幣',previousCash:0,currentCash:0,prevCoins:0,currentCoins:0,prevReturned:0,currentReturned:122,currentMerchantCovered:true},{aid:'old-buyer',name:'仍買幣',previousCash:100,currentCash:0,prevCoins:120,currentCoins:240,prevReturned:0,currentReturned:0,currentMerchantCovered:true},{aid:'old-unfunded',name:'未再補入',previousCash:100,currentCash:0,prevCoins:0,currentCoins:0,prevReturned:0,currentReturned:0,currentMerchantCovered:true}]}];`,h.context);
 renderRoute(h,'win','2026-10','retention');
 const data=vm.runInContext(`samePeriodPayerData('win','2026-10')`,h.context);h.context.testComparison=data;
 assert.equal(vm.runInContext(`samePeriodPayerRows(testComparison,{filter:'none'}).length`,h.context),1);
 assert.equal(vm.runInContext(`samePeriodPayerRows(testComparison,{filter:'none'})[0].aid`,h.context),'old-unfunded');
 assert.equal(vm.runInContext(`samePeriodPayerRows(testComparison,{filter:'shift'})[0].aid`,h.context),'old-buyer');
 assert.equal(vm.runInContext(`samePeriodFundingStatus(testComparison.rows[0],testComparison)`,h.context),'本期僅賣幣');
 assert.match(vm.runInContext(`samePeriodPayerTable(testComparison,{filter:'all'})`,h.context),/本期買幣換算/);
});
for(const product of products)test(`${product.name}: September, October and empty November routes render and bind`,async()=>{
 const h=await harness(),sections=product.kind==='own'?ownSections:[...aggregateSections,...(product.kind==='competitor'?['merchant','retention','structure','activities','packages']:[])],failures=[];
 for(const month of months)for(const section of sections){
  try{
   const routed=renderRoute(h,product.key,month,section);
   if(product.kind==='own'&&section==='monthly'){assert.match(routed,/class="monthly-report"/,'monthly route must use the integrated monthly-v2 implementation');assert.match(routed,/財務全貌/);assert.match(routed,/機台、投注與平台失分/);}
   if(product.kind==='competitor'&&section==='merchant'){
    const html=h.document.querySelector('#content').innerHTML;
    const network=dashboard.competitorMerchantNetwork?.platforms?.find(g=>g.platform===product.key);
    if(['goldfun','o9'].includes(product.key)&&network?.coverage?.weekly?.available===false){
     assert.equal(network.coverage.dailyCompleteDays.length,0,'new competitors have no observed complete network days, not six synthetic zero days');
     assert.equal(network.candidates.length,0,'no source cannot manufacture network candidates');
     assert.match(html,/週區間排行未取得/,'missing network source must remain explicitly unavailable in every selected month');
     const scenario=dashboard.competitorFundingScenarios?.platforms?.find(g=>g.platform===product.key);assert.equal(scenario?.officialRevenue,null);assert.equal(scenario?.current?.buyAmount,null);
    }else if(month==='2026-10'&&dashboard.competitorFundingScenarios?.platforms?.some(g=>g.platform===product.key)){
     assert.match(html,/data-cn-root=/,'competitor merchant route must use the deep network panel');
     assert.match(html,/候選名單試算，不是實際營收/,'unconfirmed financial scenarios must keep their identity warning in the real route');
     assert.match(html,/正式營收[\s\S]*待核定/,'a hypothesis amount cannot fill the official revenue card');
     const scenario=dashboard.competitorFundingScenarios.platforms.find(g=>g.platform===product.key);
     assert.equal(scenario.officialRevenue,null);
     assert.equal(scenario.includeInActualRevenue,false);
     if(product.key==='o8'){
      assert.match(html,/使用者確認：直播主/);
      assert.match(html,/起訖時間要限制今天以前7天內/);
      assert.equal(scenario.current.buyAmount,null);
      assert.equal(scenario.change.cashComparable,true);
     }
     const group=dashboard.competitorMerchantNetwork.platforms.find(g=>g.platform===product.key);
     const available=group.coverage.dailyCompleteDays,missing=group.coverage.missingCompleteDays,expected=group.coverage.expectedCompleteDays;
     assert.equal(new Set(available).size,available.length,'observed complete dates must remain unique');
     assert.deepEqual([...available,...missing].sort(),[...expected].sort(),'every expected date is either observed or explicitly missing');
     for(const date of available)assert.ok(group.coverage.dailySources.some(s=>s.date===date&&s.complete===true),'complete days require their actual independently validated source');
     for(const candidate of group.candidates)assert.ok(html.includes(String(candidate.aid)),'full candidate AID must reach the real route');
    }else assert.match(html,/此月尚無深度往來來源/,'weekly October observation must not be presented as another month');
   }
   if(product.kind==='competitor'&&section==='activities')assert.match(routed,/活動(?:發放|金流)/,'competitor activity route must render platform-scoped activity source or its explicit gap');
   if(product.kind==='competitor'&&section==='packages')assert.match(routed,/成功購買筆數/,'competitor packages route must render the actual order-summary view');
   if(product.kind==='all')assert.match(h.document.querySelector('#productName').textContent,/^六站(?:比較|總覽)$/);
   else assert.equal(h.document.querySelector('#productName').textContent,product.name);
  }catch(error){failures.push(new Error(`${product.key} / ${month} / ${section}: ${error.message}`,{cause:error}));}
 }
 if(failures.length)throw new AggregateError(failures,failures.map(e=>e.message).join('\n'));
});
test('integrated competitor month chart and section tabs change the actual route',async()=>{
 const h=await harness(),product=dashboard.competitors[0];
 renderRoute(h,product.key,'2026-10','overview');
 const monthPoint=h.document.querySelectorAll('[data-month-index]').find(n=>n.dataset.monthIndex==='8');
 assert.equal(typeof monthPoint?.onclick,'function','annual chart points must be bound');
 monthPoint.click();
 assert.equal(vm.runInContext('state.month',h.context),'2026-09');assert.equal(vm.runInContext('state.section',h.context),'monthly');
 const sourceTab=h.document.querySelector('#sections').querySelectorAll('button').find(n=>n.dataset.section==='sources');
 assert.equal(typeof sourceTab?.onclick,'function');sourceTab.click();
 assert.equal(vm.runInContext('state.section',h.context),'sources');assert.match(h.document.querySelector('#content').innerHTML,/來源/);
});
test('empty November overview keeps missing own-site values visible as unavailable',async()=>{
 const h=await harness();
 for(const p of dashboard.platforms){const html=renderRoute(h,p.key,'2026-11','overview');assert.ok(html.includes('—')||html.includes('尚無')||html.includes('待'),'missing month should not render a fabricated numerical result');}
});

test('specified conversion rules reach 20-day cards and annual totals while the 19-day transaction graph keeps its missing day',async()=>{
 const h=await harness(),html=renderRoute(h,'win','2026-10','overview');
 const funding=dashboard.funding.find(f=>f.platform==='win'&&f.month==='2026-10');
 assert.equal(funding.through,'2026-10-20');assert.equal(funding.prevThrough,'2026-09-20');assert.equal(funding.directCash,723900);
 const expectedBuy=funding.buyCoins/coinPolicy.rates.win.buyDivisor,expectedSell=funding.sellCoins/coinPolicy.rates.win.sellDivisor;
 assert.equal(expectedBuy,1474480);assert.equal(expectedSell,1671700);assert.equal(funding.directCash+expectedBuy-expectedSell,526680);
 for(const value of [526680,1474480,1671700,funding.buyCoins])assert.ok(html.includes(value.toLocaleString('zh-TW')),String(value));
 assert.match(html,/年度官儲與買賣幣/);assert.match(html,/每日官儲與買賣幣對照/);
 const charts=JSON.parse(vm.runInContext('JSON.stringify([...chartStore.values()].map(c=>({series:c.series,labels:c.labels})))',h.context)),expectedDays=20;
 const annual=charts.find(c=>c.labels.length===12&&c.series.length===3),daily=charts.find(c=>c.labels.length===expectedDays&&c.series.length===6);
 assert.ok(annual&&daily);assert.equal(annual.series[1].values[9],expectedBuy);assert.equal(annual.series[2].values[9],expectedSell);
 for(let i=0;i<8;i++){const month='2026-'+String(i+1).padStart(2,'0');if(!dashboard.funding.some(f=>f.platform==='win'&&f.month===month&&f.covered)){assert.equal(annual.series[1].values[i],null);assert.equal(annual.series[2].values[i],null);}}
 const legacy=(dashboard.fundingDaily||[]).filter(r=>r.platform==='win'&&r.date>='2026-10-01'&&r.date<='2026-10-20'),map=new Map(legacy.map(r=>[r.date,r]));
 const expectedDaily=(direction)=>Array.from({length:20},(_,i)=>{const r=map.get('2026-10-'+String(i+1).padStart(2,'0'));return r?.covered===true&&typeof r[direction+'Coins']==='number'?r[direction+'Coins']/coinPolicy.rates.win[direction+'Divisor']:null;});
 assert.deepEqual(daily.series[2].values,expectedDaily('buy'));assert.deepEqual(daily.series[4].values,expectedDaily('sell'));assert.equal(daily.series.filter(s=>s.dash).length,3);
 assert.equal(legacy.at(-1).date,'2026-10-19','period ranking does not invent a completion date for additional coins');assert.equal(daily.series[2].values.at(-1),null);assert.equal(daily.series[4].values.at(-1),null);
 assert.ok(Math.abs(daily.series[2].values.reduce((s,v)=>s+(v??0),0)-1460630)<1e-8,'explicit 19-day transaction source remains separate');
 assert.ok(Math.abs(daily.series[4].values.reduce((s,v)=>s+(v??0),0)-1657700)<1e-8);
 assert.equal(vm.runInContext("coinAmount('qz','buy',1200)",h.context),1200/130);assert.equal(vm.runInContext("coinAmount('lucky','buy',1200)",h.context),1000);assert.equal(vm.runInContext("coinAmount('fcc','sell',1110)",h.context),1110/1.11);
});

test('actual build order installs local brand markup and monthly-v2 without asset network requests',async()=>{
 assert.ok(moduleOrder.includes('brand-logos.js'));assert.ok(moduleOrder.includes('monthly-v2.js'));assert.ok(moduleOrder.indexOf('brand-logos.js')<moduleOrder.indexOf('overview-v2.js'));assert.ok(moduleOrder.indexOf('monthly-v2.js')>moduleOrder.indexOf('competitor-v2.js'));
 const h=await harness(),html=renderRoute(h,'win','2026-10','monthly');assert.match(html,/class="monthly-report"/);assert.match(html,/MONTHLY INTELLIGENCE/);assert.match(html,/src="\/brand-logos\/win-v2\.webp"/);assert.match(html,/來源、截止日與資料缺口/);
 const monthButton=h.document.querySelectorAll('[data-select-month]').find(n=>n.dataset.selectMonth==='2026-09');assert.equal(typeof monthButton?.onclick,'function');monthButton.click();assert.equal(vm.runInContext('state.month',h.context),'2026-09');assert.match(h.document.querySelector('#content').innerHTML,/class="monthly-report"/);
 assert.ok(h.fetchCalls.length>0);assert.ok(h.fetchCalls.every(url=>['/api/data','/api/access'].includes(url)),'the DOM contract stub renders local image markup without fetching any assets');
});

test('compressed publication data decodes in the real load path and reaches financial and machine pages',async()=>{const h=await harness({transport:true});for(const p of dashboard.platforms){for(const s of ['overview','structure','retention','machines'])renderRoute(h,p.key,'2026-10',s);}for(const p of dashboard.competitors)renderRoute(h,p.key,'2026-10','merchant');assert.equal(vm.runInContext('D.payments.months.length',h.context),dashboard.payments.months.length);assert.equal(vm.runInContext('D.machines.rows.length',h.context),dashboard.machines.rows.length);const html=renderRoute(h,'win','2026-10','overview');assert.match(html,/526,680/);const report=renderRoute(h,'win','2026-10','monthly');assert.match(report,/class="monthly-report"/);});

test('same-period payer route is first, interactive and distinct from the full-month base for every competitor',async()=>{
 const h=await harness();h.context.newDetailData={payerComparisons:[{platform:'aos',current:'2026-10',previous:'2026-09',from:'2026-10-01',through:'2026-10-20',prevFrom:'2026-09-01',prevThrough:'2026-09-20',complete:true,rows:[{aid:'90000000001',name:'同期測試',previousCash:20000,currentCash:0}]}],detailRefresh:{platforms:[{platform:'aos',status:'partial',entries:[{kind:'ranks',from:'2026-10-01',through:'2026-10-20',lastAttemptStatus:'succeeded',lastSuccessfulCaptureAt:'2026-10-21T01:00:00Z'},{kind:'members',from:'2026-10-01',through:'2026-10-20',lastAttemptStatus:'failed',error:'login_required'}]}]}};
 vm.runInContext('Object.assign(D,newDetailData);D.cohorts=D.cohorts.filter(c=>c.platform!=="aos");for(const c of [{key:"goldfun",name:"金來快"},{key:"o9",name:"黑狗兄"}])if(!D.competitors.some(p=>p.key===c.key))D.competitors.push(c);',h.context);
 let html=renderRoute(h,'aos','2026-10','retention');assert.ok(html.startsWith('<section class="dc-payers"'));assert.match(html,/90000000001/);assert.match(html,/前月整月付費母體待補/);assert.match(html,/本次採集成功/);assert.match(html,/本次採集失敗/);assert.equal(typeof h.document.querySelector('[data-sp-search]').oninput,'function');h.document.querySelector('[data-sp-search]').oninput({target:{value:'no-match'}});assert.match(h.document.querySelector('[data-sp-rows]').innerHTML,/沒有符合/);
 for(const key of ['aos','fcc','cgb','o8','goldfun','o9']){h.context.target=key;vm.runInContext('state.section="retention";selectProduct(target)',h.context);assert.equal(vm.runInContext('state.section',h.context),'retention');assert.ok(h.document.querySelectorAll('[data-section]').some(n=>n.dataset.section==='structure'));const button=h.document.querySelectorAll('[data-section]').find(n=>n.dataset.section==='structure');button.click();assert.equal(vm.runInContext('state.section',h.context),'structure');assert.match(h.document.querySelector('#content').innerHTML,/大中小 R 付費結構/);}
 html=renderRoute(h,'aos','2026-10','monthly');assert.match(html,/MEMBER CONTRIBUTION/);
});
test('current channels use platform-specific complete period rows and expose competitor new-customer routes',async()=>{
 const h=await harness(),period=(platform,through='2026-10-20')=>({platform,month:through.slice(0,7),from:through.slice(0,7)+'-01',through,complete:true,registrations:1,firstPayers:1,firstPaidCash:123,conversionRate:1,channels:[{channel:'fresh-'+platform,registrations:1,firstPayers:1,firstPaidCash:123,conversionRate:1,medianFirstPeriodCash:123}],sources:[]});
 h.context.freshChannels={schema:1,platforms:['bo','aos'].map(platform=>({platform,periods:[period(platform,'2026-09-19'),period(platform)],players:[{platform,month:'2026-10',from:'2026-10-01',cutoff:'2026-10-20',aid:'new-'+platform,name:'ONLY-'+platform,channel:'fresh-'+platform,created:'2026-10-02',firstperiodCash:123,bound:null}]}))};vm.runInContext('D.channelsByPlatform=freshChannels',h.context);
 for(const key of ['bo','aos']){const html=renderRoute(h,key,'2026-10','new');assert.match(html,/2026-10-01 — 2026-10-20/);assert.match(html,/前期相同範圍待補，不計增減/);assert.match(html,new RegExp('fresh-'+key));assert.doesNotMatch(html,/初始未啟動|1–19日/);assert.match(h.document.querySelector('#newRows').innerHTML,new RegExp('ONLY-'+key));assert.doesNotMatch(h.document.querySelector('#newRows').innerHTML,new RegExp('ONLY-'+(key==='bo'?'aos':'bo')));assert.equal(typeof h.document.querySelector('#newSearch').oninput,'function');h.document.querySelector('#newSearch').oninput({target:{value:'does-not-exist'}});assert.doesNotMatch(h.document.querySelector('#newRows').innerHTML,/ONLY-/);}
 const missing=renderRoute(h,'qz','2026-10','new');assert.match(missing,/此期間新客渠道待完整核對/);assert.doesNotMatch(missing,/fresh-bo|fresh-aos/);renderRoute(h,'aos','2026-10','new');assert.ok(h.document.querySelectorAll('[data-section]').some(n=>n.dataset.section==='new'));
});
