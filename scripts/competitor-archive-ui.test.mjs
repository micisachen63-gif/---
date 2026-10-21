// LEGACY_RATE_FIXTURE: injected 133/144 or alternate divisors test historical/custom DTO compatibility; current production rates come only from merchant-rates.json.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';

const app=await fs.readFile(new URL('../app/app.js',import.meta.url),'utf8');
const helpers=app.slice(0,app.indexOf('function daily('));
const ui=await fs.readFile(new URL('../app/competitor-finance.js',import.meta.url),'utf8');
const css=await fs.readFile(new URL('../app/competitor-finance.css',import.meta.url),'utf8');
function fixture(){
 const dates=Array.from({length:7},(_,i)=>'2026-10-'+(i+14));
 const daily=dates.map(date=>({date,covered:true,partial:false,buyCoins:13300,sellCoins:14400,buyAmount:100,sellAmount:100,officialCash:100,scenarioRevenue:100,excludedInternalCoins:0,excludedRoleCoins:1330,sourceFiles:['rank-'+date+'.json'],capturedAt:'2026-10-21T00:00:00Z',cashSource:{complete:true,capturedAt:'2026-10-21T00:01:00Z'}}));
 const month={month:'2026-10',from:'2026-10-01',through:'2026-10-20',expectedDays:20,coveredDays:7,complete:false,buyAmount:null,sellAmount:null,scenarioRevenue:null,officialCash:2000,cashMissingDates:[],cashCoveredDays:20,cashCapturedAt:'2026-10-21T00:01:00Z',observed:{coveredDays:7,buyCoins:93100,sellCoins:100800}};
 const coverage={merchant:{months:[{month:'2026-10',expectedDays:20,coveredDays:7,missingDates:Array.from({length:13},(_,i)=>'2026-10-'+String(i+1).padStart(2,'0'))}]},cash:{months:[{month:'2026-10',expectedDays:20,coveredDays:20,missingDates:[],complete:true}]},globalGift:{months:[{month:'2026-10',expectedDays:20,coveredDays:20,missingDates:[],complete:true}]}};
 return {platforms:[],competitorArchive:{schema:1,platform:'o8',name:'發又發',rates:{buyDivisor:133,sellDivisor:144},modelVersion:'archive-v1',asOf:'2026-10-21',includedMerchants:[{aid:'00000000000000000001',nickname:'固定候選甲'}],excludedRoles:[{aid:'90000000004',nickname:'測試帳號33',role:'streamer',source:'使用者直接明確確認',confirmedOnTaipei:'2026-10-21'}],recentWindow:{from:'2026-10-14',through:'2026-10-20',expectedDays:7,coveredDays:7,complete:true},daily,monthly:[month],coverage,history:{definition:'全站收贈，不冒充幣商方向',daily:dates.map(date=>({date,totalGiftCoins:10000,givenCoins:null,receivedCoins:null,complete:true,partial:false,capturedAt:'2026-10-21T00:02:00Z',sourceFiles:['global-gift.json']})),monthly:[{month:'2026-10',from:'2026-10-01',through:'2026-10-20',totalGiftCoins:200000,complete:true,partial:false,capturedAt:'2026-10-21T00:02:00Z'}],sources:[{header:['DO_NOT_RENDER_PRIVATE_HEADER'],rows:[['DO_NOT_RENDER_PRIVATE_RAW']]}]},schedule:{time:'08:00',timezone:'Asia/Taipei',configured:false,status:'not_configured',lastSuccessfulCaptureAt:null,lastAttemptAt:null,sourceUpdatedAt:null}}};
}
function context(payload=fixture()){
 const c=vm.createContext({payload,chartCalls:[]});
 vm.runInContext(helpers+'\nD=payload;function chart(series,labels,options){chartCalls.push({series,labels,options});return String(123);}\n'+ui,c);
 return c;
}
const evaluate=(c,text)=>vm.runInContext(text,c);
const render=(c,platform='o8',month='2026-10')=>evaluate(c,`competitorFinancePanel(${JSON.stringify(platform)},${JSON.stringify(month)})`);

test('o8 adds seven-day independent cash/candidate amounts, fixed rules and source-backed trend series',()=>{
 const c=context(),h=render(c);
 assert(h.includes('發又發 · 近7日與歷史檔案'));assert(h.includes('已保存 7／7 個完整日'));
 assert.equal(evaluate(c,'chartCalls[0].series[1].name'),'候選買幣 ÷ 133');assert.equal(evaluate(c,'chartCalls[0].series[2].name'),'候選賣幣 ÷ 144');
 assert.equal(evaluate(c,'chartCalls[0].options.format(2000000)'),'200萬');assert.equal(evaluate(c,'chartCalls[1].options.format(-25000)'),'-2.5萬');
 assert(h.includes('<strong>700.00<small>後台現金'));assert(h.includes('官儲＋候選買幣－候選賣幣'));
 assert(h.includes('00000000000000000001'));assert(h.includes('測試帳號33'));assert(h.includes('不推定與任何金庫同一實控'));
 assert(h.includes('rank-2026-10-14.json'));assert(h.includes('全站收贈是遊戲幣流量'));
 assert.equal(evaluate(c,'chartCalls.length'),2);assert.equal(evaluate(c,'chartCalls[0].series.length'),3);
 assert.deepEqual(JSON.parse(evaluate(c,'JSON.stringify(chartCalls[0].labels)')),['10/14','10/15','10/16','10/17','10/18','10/19','10/20']);
});

test('missing gift date preserves cash but breaks trial totals and chart segments instead of inventing zero',()=>{
 const d=fixture(),day=d.competitorArchive.daily[2];day.covered=false;day.buyAmount=0;day.sellAmount=0;day.scenarioRevenue=100;
 const c=context(d),h=render(c);
 assert(h.includes('已保存 6／7 個完整日'));assert(h.includes('買賣幣來源缺漏'));assert(h.includes('<strong>700.00<small>後台現金'));
 assert.equal(evaluate(c,'chartCalls[0].series[1].values[2]'),null);assert.equal(evaluate(c,'chartCalls[1].series[0].values[2]'),null);
 assert(h.includes('<strong>—<small>台幣試算'));
});

test('explicit complete zero survives while partial captures and missing cash cannot produce trial revenue',()=>{
 const d=fixture();Object.assign(d.competitorArchive.daily[0],{buyCoins:0,buyAmount:0,sellCoins:0,sellAmount:0,officialCash:0,scenarioRevenue:0});
 d.competitorArchive.daily[1].partial=true;d.competitorArchive.daily[2].cashSource.complete=false;
 const c=context(d),h=render(c);
 assert.equal(evaluate(c,'chartCalls[0].series[1].values[0]'),0);assert.equal(evaluate(c,'chartCalls[0].series[1].values[1]'),null);
 assert.equal(evaluate(c,'chartCalls[0].series[0].values[2]'),null);assert.equal(evaluate(c,'chartCalls[1].series[0].values[2]'),null);
 assert(h.includes('未結快照 · 不計完整日'));assert(h.includes('<td>0.00</td>'));
});

test('selected month guards recent data and history coverage exposes exact missing dates without extrapolation',()=>{
 const c=context(),h=render(c,'o8','2026-09');
 assert(h.includes('2026-09 尚無近7日逐日買賣幣來源'));assert.equal(evaluate(c,'chartCalls.length'),0);
 const current=render(context());assert(current.includes('2026-10-01、2026-10-02'));assert(current.includes('13 日缺漏'));
 assert(current.includes('候選買賣日檔缺日期'));assert(current.includes('這不是月總額'));assert(current.includes('所選月候選買幣'));
 assert(!current.includes('原始資料未齊但按7日推估'));
});

test('cross-month recent window only draws the selected-month intersection',()=>{
 const d=fixture();d.competitorArchive.recentWindow={from:'2026-09-28',through:'2026-10-04'};
 d.competitorArchive.daily=[...['2026-09-28','2026-09-29','2026-09-30','2026-10-01','2026-10-02','2026-10-03','2026-10-04'].map(date=>({...d.competitorArchive.daily[0],date}))];
 const c=context(d),h=render(c);assert(h.includes('僅呈現所選月份交集'));assert.equal(evaluate(c,'chartCalls[0].labels.length'),4);
 assert.equal(evaluate(c,'chartCalls[0].labels[0]'),'10/01');assert(h.includes('<strong>400.00<small>後台現金'));
});

test('schedule is never described as successful without actual source and capture timestamps',()=>{
 const d=fixture();Object.assign(d.competitorArchive.schedule,{status:'success',configured:true,lastSuccessfulCaptureAt:'2026-10-21T00:00:00Z',sourceUpdatedAt:null});
 let h=render(context(d));assert(!h.includes('最近保存成功'));
 d.competitorArchive.schedule.sourceUpdatedAt='2026-10-21T00:01:00Z';h=render(context(d));assert(h.includes('買賣明細已保存 · 附加日報尚未實測'));assert(!h.includes('最近保存成功'));
 d.competitorArchive.schedule.enrichment={cash:{ok:true,capturedAt:'2026-10-21T00:00:10Z'},globalGift:{ok:true,capturedAt:'2026-10-21T00:00:20Z'}};h=render(context(d));assert(h.includes('最近保存成功'));assert(h.includes('最後成功擷取'));assert(h.includes('狀態來源更新'));
 d.competitorArchive.schedule.status='login_required';h=render(context(d));assert(h.includes('登入失效 · 待重新登入'));
 d.competitorArchive.schedule.status='failed';d.competitorArchive.schedule.failureAt='2026-10-21T01:00:00Z';h=render(context(d));assert(h.includes('最近保存失敗'));assert(h.includes('失敗時間'));
});

test('gift success with failed cash clearly stays incomplete while successful gift-summary metadata is escaped and errors stay private',()=>{
 const d=fixture(),s=d.competitorArchive.schedule;
 Object.assign(s,{status:'success',configured:true,partial:true,lastSuccessfulCaptureAt:'2026-10-21T00:00:00Z',sourceUpdatedAt:'2026-10-21T00:01:00Z',enrichment:{cash:{ok:false,capturedAt:null,from:'2026-10-15',through:'2026-10-20',error:'PRIVATE_ERROR_BODY_<script>not_rendered</script>'},globalGift:{ok:true,capturedAt:'2026-10-21T00:00:30Z',from:'<img onerror=bad>',through:'2026-10-20',error:null}}});
 let h=render(context(d));assert(h.includes('逐日已保存 · 部分來源待補'));assert(!h.includes('最近保存成功'));
 assert(h.includes('<dt>官儲日報</dt><dd><b>失敗</b>'));assert(h.includes('<dt>全站收贈日報</dt><dd><b>成功</b>'));
 assert(h.includes('2026-10-15 — 2026-10-20'));assert(h.includes('&lt;img onerror=bad&gt;'));assert(!h.includes('<img'));assert(!h.includes('PRIVATE_ERROR_BODY'));assert(!h.includes('<script>'));
 s.partial=false;h=render(context(d));assert(h.includes('逐日已保存 · 部分來源待補'),'an explicit enrichment failure also blocks full success without the partial flag');
});

test('daily success does not imply complete monthly rankings and each exact window stays visible',()=>{
 const d=fixture(),a=d.competitorArchive;a.platform='aos';a.name='黑桃A';
 Object.assign(a.schedule,{status:'success',configured:true,lastSuccessfulCaptureAt:'2026-10-21T00:00:00Z',sourceUpdatedAt:'2026-10-21T00:01:00Z',enrichment:{cash:{ok:true,capturedAt:'2026-10-21T00:00:10Z'},globalGift:{ok:true,capturedAt:'2026-10-21T00:00:20Z'}},monthlyRanks:{required:true,complete:false,windows:[{from:'2026-10-01',through:'2026-10-20',ok:true,capturedAt:'2026-10-21T00:00:30Z'},{from:'2026-09-01',through:'2026-09-20',ok:false,capturedAt:null,error:'PRIVATE_ERROR'}]}});
 let h=render(context(d),'aos');assert(h.includes('逐日已保存 · 部分來源待補'));assert(h.includes('月收贈排行'));assert(h.includes('2026-09-01 — 2026-09-20 · 待補'));assert(!h.includes('PRIVATE_ERROR'));assert(!h.includes('最近保存成功'));
 a.schedule.monthlyRanks.complete=true;Object.assign(a.schedule.monthlyRanks.windows[1],{ok:true,capturedAt:'2026-10-21T00:00:40Z'});
 h=render(context(d),'aos');assert(h.includes('最近保存成功'));
});

test('other competitors keep their original interface, private raw is absent and labels are escaped',()=>{
 const d=fixture(),c=context(d);assert.equal(render(c,'aos'),evaluate(c,"cfBaseFinancePanel('aos','2026-10')"));assert.equal(render(c,'fcc'),evaluate(c,"cfBaseFinancePanel('fcc','2026-10')"));
 const h=render(c);assert(!h.includes('DO_NOT_RENDER_PRIVATE_HEADER'));assert(!h.includes('DO_NOT_RENDER_PRIVATE_RAW'));
 d.competitorArchive.includedMerchants[0].nickname='<img onerror=bad>';const escaped=render(context(d));assert(escaped.includes('&lt;img onerror=bad&gt;'));assert(!escaped.includes('<img'));
 assert(css.includes("'Segoe UI',Arial,var(--sans)"));assert(css.includes('.cfa-coverage-grid'));assert(css.includes('@media(max-width:700px)'));
});

test('closed daily gift totals stay distinct from a later unfinished monthly snapshot and missing directional columns',()=>{
 const d=fixture(),a=d.competitorArchive;
 a.history.daily=Array.from({length:20},(_,i)=>({date:'2026-10-'+String(i+1).padStart(2,'0'),totalGiftCoins:1000,givenCoins:null,receivedCoins:null,complete:true,partial:false,capturedAt:'2026-10-21T01:00:00Z'}));
 a.history.monthly[0]={month:'2026-10',from:'2026-10-01',through:'2026-10-21',totalGiftCoins:999999,complete:false,partial:true,capturedAt:'2026-10-21T01:01:00Z'};
 a.coverage.globalGift={daily:{months:[{month:'2026-10',expectedDays:20,coveredDays:20,missingDates:[],complete:true}]}};
 const c=context(d),h=render(c);
 assert.equal(evaluate(c,"cfaClosedGift(D.competitorArchive,'2026-10')"),20000);
 assert(h.includes('未結快照：999,999.00 原金幣'));assert(h.includes('與已結日彙總分開'));assert(h.includes('全站收贈缺日期'));
 assert(!h.includes('<td>999,999.00</td>'));
});

test('activity and benefits retain their own units and missing dates, without constructing MAU from DAU',()=>{
 const d=fixture();d.competitorArchive.history.operatingMonthly=[{month:'2026-10',from:'2026-10-01',through:'2026-10-20',averageDAU:null,loginEvents:null,fortuneClaimCoins:12345,fortuneClaimEvents:100,mobileVerificationEvents:0,lineVerificationEvents:2,activeMissingDates:['2026-10-04'],benefitMissingDates:[],capturedAt:'2026-10-21T01:00:00Z'}];
 d.competitorArchive.history.operatingDaily=[{date:'2026-10-01',dau:100,loginEvents:101,onlineHours:10.5,fortuneClaimEvents:3,fortuneClaimCoins:0,mobileVerificationEvents:0,lineVerificationEvents:0},{date:'2026-10-02',dau:null,loginEvents:null,fortuneClaimCoins:12345}];
 const c=context(d),h=render(c);
 assert(h.includes('歷史活躍與福利'));assert(h.includes('不是跨日去重的 MAU'));assert(h.includes('發財金領取金幣'));assert(h.includes('2026-10-04'));
 assert.equal(evaluate(c,'chartCalls[2].series[0].values[0]'),100);assert.equal(evaluate(c,'chartCalls[2].series[0].values[1]'),null);
 assert(h.includes('事件或次數'));assert(h.includes('<strong>12,345.00<small>本站原金幣'));
});

test('registration is only a source-complete period count and is never distributed across daily rows',()=>{
 const d=fixture();d.competitorArchive.history.operatingMonthly=[{month:'2026-10',from:'2026-10-01',through:'2026-10-20',registration:333,registrationPeriodComplete:true,registrationSource:{from:'2026-10-01',through:'2026-10-20',capturedAt:'2026-10-21T01:00:00Z'},activeMissingDates:[],benefitMissingDates:[]}];
 let c=context(d),h=render(c);assert(h.includes('<strong>333.00<small>人'));
 assert(h.includes('不將月註冊拆成每日'));assert(h.includes('註冊 2026-10-01 — 2026-10-20'));
 d.competitorArchive.history.operatingMonthly[0].registrationPeriodComplete=false;c=context(d);h=render(c);assert(!h.includes('<strong>333.00<small>人'));
});

test('cash-only prior-week comparison is independent from unavailable merchant history',()=>{
 const d=fixture();d.competitorArchive.recentWindow.comparison={from:'2026-10-07',through:'2026-10-13',comparable:false,previousSummary:{cashComplete:true,officialCash:1000},reason:'前7日候選來源未齊，不計買賣幣增減'};
 const h=render(context(d));assert(h.includes('官儲對照前7日 2026-10-07 — 2026-10-13：差額 -300.00'));assert(h.includes('-30.0%'));assert(h.includes('不計買賣幣增減'));
});

function multiFixture(){
 const d=fixture(),legacy=d.competitorArchive,configs=[['aos','黑桃A',1.1,1.11],['fcc','財哥',1.105,1.21],['cgb','超吉爆',135,140]];
 d.competitorArchives={schema:1,platforms:configs.map(([platform,name,buyDivisor,sellDivisor],index)=>{const a=JSON.parse(JSON.stringify(legacy));Object.assign(a,{platform,name,rates:{buyDivisor,sellDivisor},includedMerchants:[{aid:'00000000000000000001',nickname:name+'固定候選'}],excludedRoles:[]});a.daily=a.daily.map(day=>({...day,buyCoins:buyDivisor*(index+1)*100,buyAmount:(index+1)*100,sellCoins:sellDivisor*100,sellAmount:100,scenarioRevenue:(index+1)*100}));return a;})};
 return d;
}
function addSeptemberRank(a){
 const missing=Array.from({length:30},(_,i)=>'2026-09-'+String(i+1).padStart(2,'0'));
 const m={month:'2026-09',from:'2026-09-01',through:'2026-09-30',monthScope:{from:'2026-09-01',through:'2026-09-30',fullCalendarMonth:true,partialMonth:false},expectedDays:30,coveredDays:0,dailyCoveredDays:0,dailyComplete:false,dailyMissingDates:missing,missingDates:missing,complete:true,directionSource:'monthly_pair_ranking',coverageStatus:'monthly_aggregate_available_daily_missing',buyAmount:100000,sellAmount:90000,scenarioRevenue:13000,officialCash:3000,cashMissingDates:[],monthRank:{covered:true,from:'2026-09-01',through:'2026-09-30',totalRows:1436,partial:false,validation:{valid:true},sourceFiles:['closed-full-september.json'],capturedAt:'2026-10-21T00:00:00Z',byMerchant:[{aid:'00000000000000000001',nickname:'source-alias-not-authority',externalOutCoins:110000,externalInCoins:99900,internalOutCoins:1000,internalInCoins:2000,excludedRoleOutCoins:0,excludedRoleInCoins:0},{aid:'PRIVATE_GENERAL_PEER_AID',nickname:'PRIVATE_GENERAL_PEER_NAME',externalOutCoins:987654321}]}};
 a.monthly.push(m);a.coverage.merchant.months.push({month:m.month,expectedDays:30,coveredDays:0,missingDates:missing});a.coverage.cash.months.push({month:m.month,expectedDays:30,coveredDays:30,complete:true,missingDates:[]});a.history.monthly.push({month:m.month,from:m.from,through:m.through,totalGiftCoins:1100000,complete:true,partial:false});return m;
}

test('multi-platform archives use each local name, rates, roster and legacy o8 fallback without cross-site leakage',()=>{
 const d=multiFixture(),c=context(d);
 for(const [platform,name,rule] of [['aos','黑桃A','1.1'],['fcc','財哥','1.105'],['cgb','超吉爆','135']]){const h=render(c,platform);assert(h.includes(name+' · 近7日與歷史檔案'));assert(h.includes('原金幣 ÷ '+rule));assert(h.includes(name+'固定候選'));assert(!h.includes('測試帳號33'));assert(!h.includes('原金幣 ÷ 133'));}
 assert(render(c,'o8').includes('發又發 · 近7日與歷史檔案'));
 d.competitorArchives.platforms.push({...d.competitorArchive,name:'新版發又發'});assert(render(context(d),'o8').includes('新版發又發 · 近7日與歷史檔案'));
});

test('complete month ranking supplies monthly scenario despite missing all daily captures, and only fixed candidates are disclosed',()=>{
 const d=multiFixture();addSeptemberRank(d.competitorArchives.platforms[0]);const c=context(d),h=render(c,'aos','2026-09');
 assert(h.includes('整月收贈排行'));assert(h.includes('整月排行已取得'));assert(h.includes('完整曆月'));assert(h.includes('2026-09-01 — 2026-09-30'));
 assert(h.includes('<strong>100,000.00<small>台幣試算'));assert(h.includes('<strong>90,000.00<small>台幣試算'));assert(h.includes('<strong>13,000.00<small>台幣試算'));
 assert(h.includes('30 日缺漏'));assert(h.includes('月度買賣方向來自已核對的完整區間排行'));assert(h.includes('完整排行 1,436 列方向配對'));
 assert(h.includes('<td>110,000.00</td>'));assert(h.includes('<td>99,900.00</td>'));assert(h.includes('<td>1,000.00</td>'));assert(h.includes('<td>2,000.00</td>'));assert(h.includes('<td>0.00</td>'));
 assert(h.includes('closed-full-september.json'));assert(!h.includes('PRIVATE_GENERAL_PEER'));assert(!h.includes('source-alias-not-authority'));assert(h.includes('黑桃A固定候選'));
});

test('invalid, partial or mismatched month rankings never turn supplied raw totals into a known monthly trial',()=>{
 for(const mutate of [m=>m.monthRank.validation.valid=false,m=>m.monthRank.partial=true,m=>m.monthRank.through='2026-09-20']){const d=multiFixture(),m=addSeptemberRank(d.competitorArchives.platforms[0]);mutate(m);const h=render(context(d),'aos','2026-09');assert(h.includes('所選月尚無完整排行來源'));assert(!h.includes('<strong>100,000.00<small>台幣試算'));assert(!h.includes('<td>110,000.00</td>'));assert(h.includes('<strong>3,000.00<small>後台現金'));}
});

test('month selector stays on the requested competitor merchant view and partial-calendar scope remains explicit',()=>{
 const d=multiFixture(),a=d.competitorArchives.platforms[0],m=addSeptemberRank(a);m.monthScope.fullCalendarMonth=false;m.monthScope.partialMonth=true;m.through=m.monthRank.through='2026-09-20';
 const c=context(d),h=render(c,'aos','2026-09');assert(h.includes('月內區間排行已取得'));assert(h.includes('非完整月'));
 const select={dataset:{cfaRankMonth:'aos'},value:'2026-09'},document={querySelectorAll:()=>[select]};c.document=document;c.render=()=>{c.didRender=true;};evaluate(c,'bindCompetitorArchive()');select.onchange();
 assert.equal(evaluate(c,'state.product'),'aos');assert.equal(evaluate(c,'state.month'),'2026-09');assert.equal(evaluate(c,'state.section'),'merchant');assert.equal(c.didRender,true);
});

test('a complete month ranking remains auditable when reconciliation blocks its financial trial',()=>{
 const d=multiFixture(),m=addSeptemberRank(d.competitorArchives.platforms[0]);m.complete=false;m.coverageStatus='source_mismatch';m.reconciliation={status:'mismatch'};
 const h=render(context(d),'aos','2026-09');assert(h.includes('月排行與同期間逐日歸檔尚未對平'));assert(!h.includes('<strong>100,000.00<small>台幣試算'));assert(h.includes('<td>110,000.00</td>'));assert(h.includes('不與逐日相加'));
});
