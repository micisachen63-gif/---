/* Monthly report view: exact periods remain attached to every domain. */
function mrFinite(v){return typeof v==='number'&&Number.isFinite(v)?v:null;}
function mrEnd(month){return new Date(Date.UTC(Number(month.slice(0,4)),Number(month.slice(5)),0)).toISOString().slice(0,10);}
function mrSpan(value){const p=value?.period||value||{};return p.from&&p.through?`${p.from} — ${p.through}`:'來源期間待補';}
function mrValue(value,key){return mrFinite(value?.[key]);}
function mrFutureMonth(month){const observed=D.monthlyReports?.asOf?.slice(0,7);return /^\d{4}-\d{2}$/.test(observed||'')&&month>observed;}
function mrRevenueBasis(report,platform=report?.platform){const candidate=report?.isCompetitor===true||(D.competitors||[]).some(p=>p.key===platform),key=candidate?'scenarioRevenue':'revenue';return{candidate,key,label:candidate?'情境營收':'營收',value:mrValue(report?.financial?.current,key)};}
function mrRate(current,previous){return mrFinite(current)!==null&&mrFinite(previous)!==null&&previous>0?current/previous-1:null;}
function mrCompare(current,previous,aligned=true,digits=0){
 if(!aligned||current===null||previous===null)return '<span class="mr-pending">同口徑比較待補</span>';
 const delta=current-previous,rate=mrRate(current,previous);
 return `<b class="${delta<0?'down':delta>0?'up':''}">${delta>0?'+':''}${num(delta,digits)}</b><span>${rate===null?(previous===0?'前期為 0 · 以差額閱讀':'前期非正值 · 以差額閱讀'):(rate>0?'+':'')+percent(rate)}</span>`;
}
function mrExact(value,period){return value&&value.from===period?.from&&value.through===period?.through;}
function mrFallback(platform,month){
 const q=pair(platform,month),from=month+'-01',through=q.a.at(-1)?.[0]||null,previousFrom=prevMonth(month)+'-01',previousThrough=q.b.at(-1)?.[0]||null;
 const period={from,through},previousPeriod={from:previousFrom,through:previousThrough},f=(D.funding||[]).find(x=>x.platform===platform&&x.month===month),currentCash=q.currentComplete?mrFinite(q.now?.cash):null,previousCash=q.previousComplete?mrFinite(q.before?.cash):null;
 const currentCoins=f?.covered===true&&f.from===from&&f.through===through,previousCoins=f?.previousMerchantCovered===true&&f.prevFrom===previousFrom&&f.prevThrough===previousThrough;
 const c={...period,officialCashComplete:q.currentComplete,merchantCovered:!!currentCoins,cash:currentCash,buyCoins:currentCoins?mrFinite(f.buyCoins):null,sellCoins:currentCoins?mrFinite(f.sellCoins):null},p={...previousPeriod,officialCashComplete:q.previousComplete,merchantCovered:!!previousCoins,cash:previousCash,buyCoins:previousCoins?mrFinite(f.prevBuyCoins):null,sellCoins:previousCoins?mrFinite(f.prevSellCoins):null};
 for(const value of [c,p]){value.buyAmount=coinAmount(platform,'buy',value.buyCoins);value.sellAmount=coinAmount(platform,'sell',value.sellCoins);value.revenue=revenueAmount(platform,value.cash,value.buyCoins,value.sellCoins);}
 return{platform,month,period,previousPeriod,comparisonMode:q.fullMonth?'full_month':'same_days',financial:{current:c,previous:p,aligned:q.comparable},activity:{current:{...period,dau:q.currentComplete?mrFinite(q.now?.dau):null,payRate:q.currentComplete?mrFinite(q.now?.payRate):null},previous:{...previousPeriod,dau:q.previousComplete?mrFinite(q.before?.dau):null,payRate:q.previousComplete?mrFinite(q.before?.payRate):null},aligned:q.comparable},missingModules:['registration','uniqueAudience','payers','tiers','churn','promotions','packages','machines']};
}
function monthlyReportData(platform,month){return D.monthlyReports?.months?.find(r=>r.platform===platform&&r.month===month)||mrFallback(platform,month);}
function mrPeriodNote(domain,label='來源'){
 const c=domain?.current,p=domain?.previous;
 return `<p class="mr-source">${esc(label)} · 本期 ${esc(mrSpan(c))}${p?' ／ 前期 '+esc(mrSpan(p)):''}${domain?.aligned===false?' · 來源未齊或期間未對齊，僅列觀測；各指標依完整度計算差異。':''}${c?.observationOnly===true||c?.unclosedAtCapture===true?' · 採集當日未結觀測，不納前月比較。':c?.partial===true||c?.partialMonth===true?(c?.capturedAt&&c?.through&&c.through<new Date(Date.parse(c.capturedAt)+8*3600000).toISOString().slice(0,10)?' · 未滿整月，僅含截至所列日期的已結完整日。':' · 未滿整月，依來源截止日閱讀。'):''}${c?.capturedAt?' · 採集 '+esc(c.capturedAt):''}</p>`;
}
function mrFinancialComparable(domain,key){
 if(domain?.aligned===true)return true;
 const c=domain?.current,p=domain?.previous;
 return key==='cash'?c?.officialCashComplete===true&&p?.officialCashComplete===true:['buyAmount','sellAmount'].includes(key)?c?.merchantCovered===true&&p?.merchantCovered===true:false;
}
function mrKpi(label,key,domain,unit='台幣',digits=0){
 const c=mrValue(domain?.current,key),p=mrValue(domain?.previous,key);
 return `<article class="mr-kpi ${['revenue','scenarioRevenue'].includes(key)?'mr-kpi-primary':''}"><div><span>${esc(label)}</span><small>${esc(unit)}</small></div><strong>${num(c,digits)}</strong><div class="mr-kpi-diff">${mrCompare(c,p,mrFinancialComparable(domain,key),digits)}</div><p>前期 ${num(p,digits)}</p></article>`;
}
function mrSection(title,sub,body,button=''){return `<section class="mr-section"><header><div><span class="mr-eyebrow">MONTHLY REVIEW</span><h2>${esc(title)}</h2><p>${esc(sub)}</p></div>${button}</header>${body}</section>`;}
function mrLink(section,label){return `<button type="button" class="mr-link" data-go="${esc(section)}">${esc(label)} <span>↗</span></button>`;}
function mrMetricTable(domain,fields,unit=''){
 return table(['指標','本期','前期','差額／變化'],fields.map(([label,key,digits=0,ratio=false])=>{const c=mrValue(domain?.current,key),p=mrValue(domain?.previous,key),format=v=>ratio?percent(v):num(v,digits);return row([esc(label),format(c)+(unit?' '+esc(unit):''),format(p),ratio?(domain?.aligned===true&&c!==null&&p!==null?(c-p>0?'+':'')+num((c-p)*100,2)+' 個百分點':'—'):mrCompare(c,p,domain?.aligned===true,digits)]);}));
}
function mrFinancialStory(report){
 const f=report.financial,c=f?.current,p=f?.previous,revenueKey=report.isCompetitor?'scenarioRevenue':'revenue',known=['cash','buyAmount','sellAmount',revenueKey].every(k=>mrValue(c,k)!==null&&mrValue(p,k)!==null);
 if(f?.aligned===true&&known){const delta=c[revenueKey]-p[revenueKey],rate=mrRate(c[revenueKey],p[revenueKey]);return `<strong>${report.isCompetitor?'候選情境營收':'營收'}較前期${delta>0?'增加':delta<0?'減少':'持平'} ${num(Math.abs(delta),2)} 元${rate===null?'':'（'+(rate>0?'+':'')+percent(rate)+'）'}</strong><p>官儲差 ${cv2Delta(c.cash,p.cash,2)} ＋ 買幣換算差 ${cv2Delta(c.buyAmount,p.buyAmount,2)} − 賣幣換算差 ${cv2Delta(c.sellAmount,p.sellAmount,2)} ＝ 營收差 ${cv2Delta(c[revenueKey],p[revenueKey],2)}。${report.isCompetitor?'此為固定候選名單假設試算，正式營收仍待核定；不確認現金成交或幣商身分。':c[revenueKey]<0?'本期指定公式計算為負值；仍須分開核對活動與營運成本。':'此為指定公式營收，尚未扣活動與營運成本。'}</p>`;}
 if(mrValue(c,'cash')!==null&&mrValue(p,'cash')!==null&&mrFinancialComparable(f,'cash'))return `<strong>官儲較前期${c.cash<p.cash?'減少':'增加'} ${num(Math.abs(c.cash-p.cash))} 元</strong><p>買幣、賣幣或同期間來源尚未齊全，${report.isCompetitor?'候選情境營收差':'營收差'}保留待補；不以官儲變動代替全部營收變動。</p>`;
 return '<strong>先核對來源完整度，再判讀本月變化</strong><p>本月與前月的完整日期尚未齊全；已取得的獨立觀測列在各區，缺值不補零，也不從差異推論原因。</p>';
}
function mrAudience(report){
 const a=report.activity,u=report.uniqueAudience,r=report.registration;
 const c=a?.current,p=a?.previous,dc=mrValue(c,'dau'),dp=mrValue(p,'dau');
 const insight=a?.aligned===true&&dc!==null&&dp!==null?`日均活躍 ${num(dp,1)} → ${num(dc,1)} 人；${dc<dp?'規模縮小':'規模增加'} ${num(Math.abs(dc-dp),1)} 人／日。`:'日均活躍需兩期完整日報後比較。';
 return mrSection('玩家規模與付費強度','註冊、每日活躍與月去重會員分開閱讀',`<p class="mr-insight">${esc(insight)} 首次付費不等於本月註冊；日付費人次不等於月去重付費會員。</p><div class="mr-domain-grid"><div><h3>每日營運</h3>${mrMetricTable(a,[['日均活躍','dau',1],['每日付費率','payRate',0,true],['儲值交易筆數','transactions'],['首次付費人數／人次','firstPayers']])}${mrPeriodNote(a,'消費日報')}</div><div><h3>新註冊與月去重快照</h3>${mrMetricTable(r,[['本月新註冊','newRegistered']])}${mrPeriodNote(r,'註冊／留存來源')}${mrMetricTable(u,[['MAU','mau'],['MPU','mpu'],['月付費率','payRate',0,true],['ARPU','arpu',2],['ARPPU','arppu',2]])}${mrPeriodNote(u,'玩家活躍／消費月報')}</div></div>`,mrLink('new','查看新客渠道'));
}
function mrPayers(report){
 const p=report.payers,t=report.tiers,c=report.churn,tiers=t?.current?.bands||[],known=tiers.length>0;
 const big=tiers.find(b=>/大/.test(b.name||'')),tierInsight=big&&mrFinite(big.cashShare)!==null?`大 R ${num(mrFinite(big.count))} 人，貢獻當期官儲 ${percent(big.cashShare)}。${big.cashShare>=.5?'金額集中於大 R，需持續觀察主要玩家續購。':'其餘金額由中小 R 共同支撐。'}`:'分層依本期官儲，不以歷史累計 VIP 取代。';
 const tierCards=known?`<div class="mr-tier-grid">${tiers.map(b=>`<article><span>${esc(b.name)}</span><strong>${num(mrFinite(b.count))}<small>人</small></strong><div class="mr-tier-track"><i style="width:${Math.min(100,Math.max(0,(mrFinite(b.cashShare)??0)*100))}%"></i></div><p>官儲 ${num(mrFinite(b.cash),2)}<br>金額 ${percent(mrFinite(b.cashShare))} · 人數 ${percent(mrFinite(b.peopleShare))}</p></article>`).join('')}</div>`:'<p class="mr-empty">大中小 R 需完整期間 AID 儲值排行，取得後計算人數與金額占比。</p>';
 const ch=c?.current,base=mrValue(ch,'base'),returned=mrValue(ch,'returned'),pending=mrValue(ch,'unrenewed'),shifted=mrValue(ch,'shifted'),none=mrValue(ch,'noRepurchase');
 return mrSection('付費結構與續購','以期間官儲分類；未續購屬進度觀測，不等於離站',`<div class="mr-domain-grid"><div><h3>付費規模與集中度</h3>${mrMetricTable(p,[['去重付費會員','count'],['期間官儲','total',2],['每位付費者官儲','arppu',2],['前五大金額占比','top5Share',0,true]])}${mrPeriodNote(p,'儲值排行')}</div><div><h3>前月付費母體去向</h3><div class="mr-churn-grid">${[['前月付費母體',base],['本期仍官儲',returned],['尚未再官儲',pending],['未官儲但仍買幣',shifted],['未見官儲或買幣',none]].map(([label,v])=>`<div><span>${label}</span><strong>${num(v)}</strong></div>`).join('')}</div><p class="mr-insight">${base!==null?`追蹤前月 ${num(base)} 位官儲會員；本期 ${num(returned)} 位仍官儲，${num(pending)} 位尚未續儲。`:'完整前後期付費名單待補。'}${ch?.merchantCovered===true?'指定幣商交易已覆蓋此來源期間。':'幣商覆蓋未齊時，不能判為停止全部補入。'}${ch?.previousBasis?' 前期基準：'+esc(ch.previousBasis)+'。':''}</p>${mrPeriodNote(c,'AID 前後月名單；保留各自截止日')}</div></div><h3>大中小 R 分布</h3><p class="mr-insight">${esc(tierInsight)}</p>${tierCards}<p class="mr-source">小 R ≤ 1,000；中 R > 1,000 至 20,000；大 R > 20,000。依當期官儲，非歷史 VIP。</p>${mrPeriodNote(t,'儲值排行分層')}`,mrLink('retention','查看流失與注意名單'));
}
function mrPromotion(report){
 const promo=report.promotions,packs=report.packages,rows=promo?.current?.categories||[];
 const previousCategories=promo?.previous?.categories||[];
 const content=rows.length?table(['活動類型','本期發放金幣','前期發放金幣','差額'],rows.map(r=>row([esc(r.name),num(mrFinite(r.coins),2),num(mrFinite(previousCategories.find(p=>p.name===r.name)?.coins),2),promo.aligned===true&&mrFinite(r.coins)!==null&&mrFinite(previousCategories.find(p=>p.name===r.name)?.coins)!==null?cv2Delta(r.coins,previousCategories.find(p=>p.name===r.name)?.coins,2):'—']))):'<p class="mr-empty">此月活動發放來源尚未取得，不以其他月份或儲值優惠金幣推估活動支出。</p>';
 return mrSection('活動與儲值包','發放金幣、成功訂單與現金成本分別統計',`<div class="mr-domain-grid"><div><h3>活動發放</h3>${content}${mrPeriodNote(promo,'總金流統計')}</div><div><h3>儲值包成交</h3>${mrMetricTable(packs,[['成功購買筆數','orders'],['購買玩家數','players'],['實付現金','cash',2]])}${mrPeriodNote(packs,'成功訂單明細')}<p class="mr-insight">活動金幣不能直接視為現金成本；缺少參與者、實付金額與可比對照時，不計增量 ROI 或政策因果。</p></div></div>`,mrLink('activities','查看活動詳情'));
}
function mrMachineReport(report){
 const d=report.machines,c=d?.current,p=d?.previous,known=mrValue(c,'bets')!==null&&mrValue(c,'payouts')!==null;
 const top=(items,loss=false)=>items?.length?table(['機台／廠商',loss?'平台失分':'投注額','出分','RTP','投注筆數'],items.slice(0,5).map(r=>row([`<b>${esc(r.machineName||r.gameName||'後台未提供名稱')}</b><small class="mr-machine-vendor">${esc(r.vendor||'—')}</small>`,num(mrValue(r,loss?'platformLoss':'bets'),2),num(mrValue(r,'payouts'),2),percent(mrValue(r,'rtp')),num(mrValue(r,'rounds'))]))):'<p class="mr-empty">當月機台明細待補。</p>';
 const note=known?`本來源投注 ${num(c.bets,2)}、出分 ${num(c.payouts,2)} 遊戲幣，整體 RTP ${percent(mrValue(c,'rtp'))}。${mrValue(c,'lossSum')!==null?'失分機台的正差合計 '+num(c.lossSum,2)+'；未抵銷其他機台贏分。':''}`:c?'本月機台來源已取得，但日期或完整度尚未通過月報核對；觀測明細可由機台分析查看。不借用其他月份。':'此月尚無可用機台明細，不借用其他月份或供應商合計。';
 return mrSection('機台、投注與平台失分','原始遊戲幣；RTP 用總出分 ÷ 總投注加權計算',`<p class="mr-insight">${esc(note)}</p>${mrMetricTable(d,[['總投注','bets',2],['總出分','payouts',2],['投注減出分','profit',2],['整體 RTP','rtp',0,true]])}${mrPeriodNote(d,'機台總覽；與現金日報保持獨立截止日')}<div class="mr-observation"><span>高 RTP 觀察 <b>${num(mrValue(c,'highCount'))}</b></span><span>低 RTP 觀察 <b>${num(mrValue(c,'lowCount'))}</b></span><span>樣本不足 <b>${num(mrValue(c,'sampleCount'))}</b></span></div><p class="mr-source">觀察門檻：投注 ≥ 1,000,000、投注筆數 ≥ 1,000，RTP 85%–105%。投注筆數未知視為樣本不足；超出門檻是查核線索，不是作弊判定。不重複玩家數不跨機台相加成 MAU。</p><div class="mr-domain-grid"><div><h3>投注額前五</h3>${top(c?.topBets||c?.top5bets)}</div><div><h3>平台失分前五</h3>${top(c?.topLoss||c?.top5loss,true)}</div></div>`,mrLink('machines','深入機台明細與門檻'));
}
function mrCoverage(report){
 const domains=[['財務','financial'],['每日活躍','activity'],['註冊','registration'],['MAU／MPU','uniqueAudience'],['付費排行','payers'],['續購名單','churn'],['活動','promotions'],['儲值包','packages'],['機台','machines']];
 return `<details class="mr-coverage"><summary>來源、截止日與資料缺口 <span>展開核對 ＋</span></summary>${table(['資料區塊','本期來源區間','前期來源區間','比較狀態','來源檔案'],domains.map(([name,key])=>{const d=report[key],c=d?.current,p=d?.previous,files=[...(c?.sourceFiles||[]),...(p?.sourceFiles||[])].map(f=>typeof f==='string'?f:f.file||'').filter(Boolean);return row([name,esc(mrSpan(c)),esc(mrSpan(p)),d?.aligned===true?'同口徑可比':c?'獨立觀測／同期未齊':'待補',esc([...new Set(files)].join('、')||c?.sourceFile||'—')]);}))}<p>未取得來源保留「—」。每一區的截止日均以自身來源為準，未結月不能拿前月完整月直接宣稱衰退。</p></details>`;
}
function monthlyV2(platform=state.product,month=state.month){
 const product=[...(D.platforms||[]),...(D.competitors||[])].find(p=>p.key===platform),r=monthlyReportData(platform,month),year=String(state.year),yearRows=Array.from({length:12},(_,i)=>monthlyReportData(platform,year+'-'+String(i+1).padStart(2,'0'))),f=r.financial,candidate=r.isCompetitor===true||(D.competitors||[]).some(c=>c.key===platform),revenueKey=candidate?'scenarioRevenue':'revenue';
 const matrix=`<nav class="mr-months" aria-label="每月營收月報">${yearRows.map((m,i)=>{const revenue=mrRevenueBasis(m,platform),future=mrFutureMonth(m.month),source=m.financial?.current,from=source?.from||m.period?.from,through=source?.through||m.period?.through,cutoff=from&&through?(through===mrEnd(m.month)?from.slice(5)+'–'+through.slice(5):'截至 '+through.slice(5)):'來源待補';return`<button data-select-month="${esc(m.month)}" class="${m.month===month?'active':''} ${revenue.value===null?'missing':''}"><span>${i+1}月</span><strong>${future?'未開始':revenue.value===null?revenue.label+'待補':num(revenue.value/10000,1)+'萬'}</strong><small>${future?'尚未到此月份':esc(revenue.label+' · 台幣')+'<br>'+esc(cutoff)}</small></button>`;}).join('')}</nav>`;
 const heading=`<header class="mr-page-heading"><div><span class="mr-eyebrow">MONTHLY INTELLIGENCE</span><h1 class="mr-brand-title">${typeof brandLogo==='function'?brandLogo(platform,{size:58,decorative:true}):''}<span>${esc(product?.name||platform)} · ${esc(month)} 月報</span></h1><p>${platform==='win'&&month==='2026-01'?'開服月自 1/16 起算；月去重報表保留自身完整日曆月期間':r.comparisonMode==='full_month'?'完整月份對完整前月':'未結月依相同日數對照；各資料區塊獨立核對日期'}</p></div><div><span>本期 ${esc(mrSpan(r.period))}</span><span>前期 ${esc(mrSpan(r.previousPeriod))}</span></div></header>`;
 const finance=mrSection('財務全貌',candidate?'官儲為後台原值；買賣依固定候選名單試算，正式營收待核定':'官儲＋買幣換算－賣幣換算；未扣活動與營運成本',`<div class="mr-finance-kpis">${mrKpi(candidate?'候選情境營收':'本月營收',revenueKey,f,candidate?'台幣試算 · 非正式營收':'台幣 · 指定公式',2)}${mrKpi('官儲','cash',f)}${mrKpi(candidate?'候選買幣換算':'買幣換算','buyAmount',f)}${mrKpi(candidate?'候選賣幣換算':'賣幣換算','sellAmount',f)}</div><div class="mr-summary">${mrFinancialStory(r)}</div>${mrPeriodNote(f,candidate?'後台消費日／月報 × 固定候選收贈來源':'消費日報 × 已確認幣商收贈禮')}<details class="mr-formula"><summary>原始金幣與換算公式</summary>${table(['方向','本期金幣','前期金幣','公式'],[['buy','買幣'],['sell','賣幣']].map(([key,label])=>row([label,num(mrValue(f?.current,key+'Coins'),2),num(mrValue(f?.previous,key+'Coins'),2),esc(coinRuleLabel(platform,key))])))}</details>`,mrLink('merchant','查看幣商金流'));
 const series=[['cash','官儲','#dfc58a'],['buyAmount',candidate?'候選買幣換算':'買幣換算','#89b9a4'],['sellAmount',candidate?'候選賣幣換算':'賣幣換算','#7fa7ce'],[revenueKey,candidate?'候選情境營收':'營收','#b5a0d1']].map(([key,name,color])=>({name,color,values:yearRows.map(m=>mrValue(m.financial?.current,key))}));
 const annual=mrSection('全年每月軌跡',year+' 年 · 未結月標示截至日期，缺月不補零',chart(series,yearRows.map((_,i)=>(i+1)+'月'),{format:v=>num(v/10000,1)+'萬',clicks:true})+`<details class="mr-year-table"><summary>各月份具體數值與截止日</summary>${table(['月份','官儲',candidate?'候選買幣換算':'買幣換算',candidate?'候選賣幣換算':'賣幣換算',candidate?'候選情境營收':'營收','日均活躍','新註冊','MAU','機台 RTP','財務截止'],yearRows.map(m=>row([`<button data-select-month="${esc(m.month)}">${esc(m.month)}</button>`,...['cash','buyAmount','sellAmount',revenueKey].map(k=>num(mrValue(m.financial?.current,k),2)),num(mrValue(m.activity?.current,'dau'),1),num(mrValue(m.registration?.current,'newRegistered')),num(mrValue(m.uniqueAudience?.current,'mau')),percent(mrValue(m.machines?.current,'rtp')),esc(m.period?.through||'待補')])))}<p class="mr-source">MAU與機台為各自來源快照，完整截止日列於所選月份區塊。</p></details>`);
 const mix=!candidate&&typeof memberMixPanel==='function'?memberMixPanel(platform,month):'';
 return `<div class="monthly-report">${heading}${matrix}${finance}${annual}${mrAudience(r)}${mix}${mrPayers(r)}${mrPromotion(r)}${mrMachineReport(r)}${mrCoverage(r)}</div>`;
}
const monthlyLegacy=monthly;
monthly=function(){return(D.platforms||[]).some(p=>p.key===state.product)?monthlyV2():monthlyLegacy();};
