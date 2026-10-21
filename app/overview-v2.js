/* Single-platform intelligence view. Uses the shared app.js data and helpers. */
function overviewNewCustomerPeriod(platform,month,from,through,registrationSource){
 const count=v=>Number.isSafeInteger(v)&&v>=0,amount=v=>typeof v==='number'&&Number.isFinite(v)&&v>=0;
 if(!registrationSource||registrationSource.platform!==platform||registrationSource.from!==from||registrationSource.through!==through||registrationSource.complete!==true||registrationSource.validation?.valid!==true||!count(registrationSource.newRegistered)||from?.slice(0,7)!==month||through?.slice(0,7)!==month)return null;
 const registrations=registrationSource.newRegistered,convert=firstPayers=>registrations>0?firstPayers/registrations:null;
 const channels=D.channelsByPlatform?.platforms?.find(r=>r.platform===platform),current=(channels?.periods||[]).find(r=>r.platform===platform&&r.month===month&&r.from===from&&r.through===through&&r.complete===true&&r.verified===true&&r.registrations===registrations&&count(r.firstPayers)&&r.firstPayers<=registrations);
 if(current)return{from,through,registrations,firstPayers:current.firstPayers,firstPaidCash:amount(current.firstPaidCash)?current.firstPaidCash:null,conversionRate:convert(current.firstPayers),source:'current_channels'};
 const mix=Array.isArray(D.memberComposition)?D.memberComposition.find(r=>r.platform===platform&&r.month===month):D.memberComposition?.[platform]?.[month],paid=mix?.metrics?.paidMembers,cohort=mix?.cohortCoverage,unknown=paid?.unknown===undefined&&paid?.verified===true&&paid?.complete===true?0:paid?.unknown;
 const aligned=r=>r?.from===from&&r?.through===through&&r?.verified===true&&r?.complete===true;
 if(!aligned(paid)||cohort?.complete!==true||cohort.memberFrom!==from||cohort.memberThrough!==through||cohort.registrationCount!==registrations||cohort.uniqueAIDs!==registrations||unknown!==0||![paid.total,paid.newRegistered,paid.existing].every(count)||paid.newRegistered>registrations||paid.newRegistered+paid.existing!==paid.total)return null;
 const deposit=mix.metrics.deposit,cash=aligned(deposit)&&[deposit.total,deposit.newRegistered,deposit.existing].every(amount)&&(deposit.unknown??0)===0&&Math.abs(deposit.newRegistered+deposit.existing-deposit.total)<=.01?deposit.newRegistered:null;
 return{from,through,registrations,firstPayers:paid.newRegistered,firstPaidCash:cash,conversionRate:convert(paid.newRegistered),source:'member_composition'};
}
function overviewV2(){
 const p=pair(),key=state.product,month=state.month;
 const number=v=>typeof v==='number'&&Number.isFinite(v);
 const date=v=>/^\d{4}-\d{2}-\d{2}/.test(v||'')?v.slice(0,10):null;
 const short=v=>date(v)?`${Number(v.slice(5,7))}/${Number(v.slice(8,10))}`:'待補';
 const period=v=>date(v)?`${Number(v.slice(5,7))}/1–${short(v)}`:'期間待補';
 const fund=(D.funding||[]).find(x=>x.platform===key&&x.month===month);
 const snapshot=(D.monthSnapshots||[]).find(x=>x.platform===key&&x.month===month);
 const composition=(D.activeComposition||[]).find(x=>x.platform===key&&x.month===month);
 const monthlyRow=D.monthly.find(x=>x.platform===key&&x.month===month);
 const cohortData=D.cohorts.find(x=>x.platform===key&&x.current===month);
 const dailyThrough=date(p.a.at(-1)?.[0]);
 const through=date(fund?.through)||dailyThrough;
 const previousThrough=date(fund?.prevThrough)||(p.comparable?date(p.b.at(-1)?.[0]):null);
 const sameDates=!!(p.comparable&&through===dailyThrough&&previousThrough===date(p.b.at(-1)?.[0]));
 const direct=number(fund?.directCash)?fund.directCash:p.now?.cash??null;
 const previousDirect=number(fund?.prevDirectCash)?fund.prevDirectCash:p.comparable?p.before?.cash??null:null;
 const buy=fund?.covered!==false&&number(fund?.buyCoins)?fund.buyCoins:null;
 const previousBuy=fund?.covered!==false&&number(fund?.prevBuyCoins)?fund.prevBuyCoins:null;
 const sell=fund?.covered!==false&&number(fund?.sellCoins)?fund.sellCoins:null;
 const previousSell=fund?.covered!==false&&number(fund?.prevSellCoins)?fund.prevSellCoins:null;
 const cashChange=sameDates?change(direct,previousDirect):null;
 const dauChange=p.comparable?change(p.now?.dau,p.before?.dau):null;
 const cohortRows=cohortData?.rows||[],repaid=cohortRows.filter(x=>x.currentCash>0),unpaid=cohortRows.filter(x=>x.currentCash===0);
 const returnRate=cohortData&&cohortRows.length?repaid.length/cohortRows.length:null;
 const noFunding=cohortData?.currentMerchantCovered?cohortRows.filter(x=>x.currentCash===0&&x.currentCoins===0):null;
 const shifted=cohortData?.currentMerchantCovered?cohortRows.filter(x=>x.currentCash===0&&x.currentCoins>0):null;
 const formatMove=v=>v===null?'同期資料待補':`${v>0?'+':v<0?'−':''}${percent(Math.abs(v))}`;
 let headline=number(direct)?`本月官儲 ${num(direct)}，持續追蹤活躍與回購。`:'本月資料尚待接入。';
 if(cashChange!==null){headline=`官儲較同期${cashChange<0?'減少':cashChange>0?'增加':'持平'}${cashChange===0?'':' '+percent(Math.abs(cashChange))}`;if(dauChange!==null&&cashChange!==0&&dauChange!==0)headline+=cashChange<0&&dauChange<0?'，活躍也在下降。':cashChange>0&&dauChange>0?'，活躍同步成長。':'，活躍呈現不同走向。';else headline+='。';}
 const facts=[];if(number(p.now?.dau))facts.push(`日均活躍 ${num(p.now.dau,1)} 人${dauChange!==null?'（'+formatMove(dauChange)+'）':''}`);if(cohortData)facts.push(`前月 ${num(cohortRows.length)} 位付費者，本月 ${num(repaid.length)} 位再次官儲`);
 const brief=`<section class="si-brief"><div class="si-brief-label"><span class="si-edition">${Number(month.slice(5))}月</span><span>本月重點<br><small>營運判讀</small></span></div><div class="si-brief-copy"><h2>${esc(headline)}</h2><p>${esc(facts.join('；')||'資料取得後，依同期官儲、活躍與逐人回購呈現重點。')}</p><div class="si-brief-meta"><span>官儲 ${esc(period(through))}${sameDates?' ／前期 '+esc(period(previousThrough)):''}</span><span>${cohortData?'回購截至 '+esc(cohortData.cutoff):'逐人回購待補'}</span></div></div><button class="si-brief-action" data-go="analysis">查看完整分析 <span>↗</span></button></section>`;
 // This sparkline contains actual daily cash only; missing dates break the line.
 const sparkline=()=>{
  if(!p.a.length)return '<div class="si-mini-empty">每日官儲紀錄待接入</div>';
  const days=Number(p.a.at(-1)[0].slice(8)),byDay=new Map(p.a.map(r=>[Number(r[0].slice(8)),r[4]]));
  const values=Array.from({length:days},(_,i)=>byDay.get(i+1)??null),max=Math.max(1,...values.filter(number)),x=i=>5+i*230/Math.max(1,days-1),y=v=>55-v/max*46;
  let segments=[],segment=[];values.forEach((v,i)=>{if(!number(v)){if(segment.length)segments.push(segment);segment=[];}else segment.push([x(i),y(v)]);});if(segment.length)segments.push(segment);
  const id='si-cash-'+key+'-'+month;
  return `<div class="si-spark"><svg viewBox="0 0 240 64" role="img" aria-label="${esc(period(dailyThrough))} 每日官儲"><defs><linearGradient id="${id}" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="#d1bb88" stop-opacity=".2"/><stop offset="100%" stop-color="#d1bb88" stop-opacity="0"/></linearGradient></defs><line x1="5" y1="55" x2="235" y2="55" stroke="#ad9c7424"/>${segments.map(s=>`${s.length>1?`<polygon points="${s[0][0]},55 ${s.map(a=>a.join(',')).join(' ')} ${s.at(-1)[0]},55" fill="url(#${id})"/>`:''}<polyline points="${s.map(a=>a.join(',')).join(' ')}" fill="none" stroke="#d1bb88" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/>`).join('')}${values.map((v,i)=>number(v)?`<circle cx="${x(i)}" cy="${y(v)}" r="1.9" fill="#dbc590"><title>${i+1}日：${num(v)} 現金</title></circle>`:'').join('')}</svg><span>每日官儲 <i>${esc(period(dailyThrough))}</i></span></div>`;
 };
 // Merchant totals have no daily series. These are two observed period totals.
 const miniTotals=(current,previous,format=num)=>{
  if(!number(current))return '<div class="si-mini-empty"><span>成功轉幣紀錄待接入</span><small>取得前保留空值</small></div>';
  const comparable=sameDates&&number(previous),max=Math.max(1,current,comparable?previous:0);
  return `<div class="si-mini-totals"><div><span>前期</span><i><b style="width:${comparable?previous/max*100:0}%"></b></i><em>${comparable?format(previous):'—'}</em></div><div class="current"><span>本期</span><i><b style="width:${current/max*100}%"></b></i><em>${format(current)}</em></div><small>同期總量對照 · 尚無逐日紀錄</small></div>`;
 };
 const flow=(type,label,direction,current,previous,unit,index)=>{
  const merchant=type!=='cash',rate=merchant&&typeof coinRate==='function'?coinRate(key,type):null;
  const converted=merchant&&number(rate)&&rate>0&&typeof coinAmount==='function';
  const shownCurrent=converted?(number(current)?coinAmount(key,type,current):null):current;
  const shownPrevious=converted?(number(previous)?coinAmount(key,type,previous):null):previous;
  const shownUnit=converted?'換算金額':unit;
  const format=value=>num(value,converted&&number(value)&&!Number.isInteger(value)?2:0);
  const comparable=sameDates&&number(shownCurrent)&&number(shownPrevious),move=comparable?change(shownCurrent,shownPrevious):null;
  const amountDifference=comparable?shownCurrent-shownPrevious:null;
  const deltaText=number(amountDifference)?(amountDifference>0?'+':'')+format(amountDifference):'—';
  const rule=converted&&typeof coinRuleLabel==='function'?coinRuleLabel(key,type):'';
  const rawLine=merchant&&number(current)?`<div class="si-flow-previous"><span>原始金幣 <b>${num(current)}</b></span><span>${converted?'÷ '+esc(String(rate))+' = '+format(shownCurrent):'換算待設定'}</span></div>`:'';
  const formulaNote=converted?`${esc(rule||'依指定比率換算')} · 非已核對成交現金`:(merchant&&number(current)?'尚未設定換算比率；主值保留原始金幣':'');
  return `<article class="si-flow si-flow-${type}"${merchant?` data-coin-raw="${number(current)?current:''}" data-coin-rate="${converted?rate:''}" data-coin-direction="${type}"`:''}><div class="si-flow-top"><div><span class="si-flow-index">0${index}</span><h3>${label}</h3><span class="si-flow-unit">${shownUnit}</span></div>${comparable?`<span class="si-delta ${move<0?'down':move>0?'up':'muted'}">${formatMove(move)}</span>`:'<span class="si-delta pending">同期待補</span>'}</div><p class="si-flow-direction">${direction}</p><div class="si-flow-value">${format(shownCurrent)}</div>${rawLine}<div class="si-flow-previous"><span>前月同期 <b>${comparable?format(shownPrevious):'—'}</b></span><span>${comparable?'差額 '+deltaText:'前後期覆蓋完整後比較'}</span></div>${type==='cash'?sparkline():miniTotals(shownCurrent,shownPrevious,format)}<div class="si-flow-period">${esc(period(through))}${comparable?' ／ '+esc(period(previousThrough)):''}${formulaNote?'<br>'+formulaNote:''}</div></article>`;
 };
 const fundingEnd=date(fund?.through)||date(fund?.to),previousFundingEnd=date(fund?.prevThrough);
 const currentCashAligned=number(fund?.directCash)?fundingEnd===through:dailyThrough===through&&p.a.length===Number(through?.slice(8));
 const previousCashAligned=number(fund?.prevDirectCash)?previousFundingEnd===previousThrough:p.comparable&&date(p.b.at(-1)?.[0])===previousThrough;
 const currentRevenueAligned=!!through&&fundingEnd===through&&currentCashAligned;
 const previousRevenueAligned=!!previousThrough&&previousFundingEnd===previousThrough&&previousCashAligned;
 const revenue=currentRevenueAligned&&number(direct)&&number(buy)&&number(sell)&&typeof revenueAmount==='function'?revenueAmount(key,direct,buy,sell):null;
 const previousRevenue=previousRevenueAligned&&number(previousDirect)&&number(previousBuy)&&number(previousSell)&&typeof revenueAmount==='function'?revenueAmount(key,previousDirect,previousBuy,previousSell):null;
 const revenueComparable=sameDates&&number(revenue)&&number(previousRevenue);
 const revenueMove=revenueComparable?change(revenue,previousRevenue):null;
 const revenueDelta=revenueComparable?revenue-previousRevenue:null;
 const formatRevenue=value=>num(value,number(value)&&!Number.isInteger(value)?2:0);
 const revenueBuy=currentRevenueAligned&&number(buy)&&typeof coinAmount==='function'?coinAmount(key,'buy',buy):null;
 const revenueSell=currentRevenueAligned&&number(sell)&&typeof coinAmount==='function'?coinAmount(key,'sell',sell):null;
 const revenueFormula=[['官儲',currentCashAligned?direct:null],['＋買幣換算',revenueBuy],['－賣幣換算',revenueSell]].map(([label,value])=>`<div class="si-flow-previous"><span>${label}</span><b>${formatRevenue(value)}</b></div>`).join('');
 const revenueCard=`<article class="si-flow si-flow-revenue"><div class="si-flow-top"><div><span class="si-flow-index">04</span><h3>本月營收</h3><span class="si-flow-unit">台幣</span></div>${revenueComparable?`<span class="si-delta ${revenueMove<0?'down':revenueMove>0?'up':'muted'}">${formatMove(revenueMove)}</span>`:'<span class="si-delta pending">同期待補</span>'}</div><p class="si-flow-direction">指定口徑 · ${number(revenue)?'依同期間資金計算':'同期間官儲與買賣幣待補'}</p><div class="si-flow-value">${formatRevenue(revenue)}</div><div class="si-flow-previous"><span>前月同期 <b>${revenueComparable?formatRevenue(previousRevenue):'—'}</b></span><span>${revenueComparable?'差額 '+(revenueDelta>0?'+':'')+formatRevenue(revenueDelta):'缺少任一項時保留空值'}</span></div><div class="si-revenue-formula" style="display:grid;gap:4px;margin-top:16px;flex:1;align-content:center">${revenueFormula}</div><div class="si-flow-period">${esc(period(through))}${revenueComparable?' ／ '+esc(period(previousThrough)):''}<br>官儲＋買幣換算－賣幣換算；未扣活動與營運成本</div></article>`;
 const flows=`<div class="si-flow-grid">${flow('cash','官儲','玩家直接儲值至平台',direct,previousDirect,'現金',1)}${flow('buy','買幣','幣商 → 玩家',buy,previousBuy,'金幣',2)}${flow('sell','賣幣','玩家 → 幣商',sell,previousSell,'金幣',3)}${revenueCard}</div><p class="si-footnote">買賣幣依指定比率換算並保留原始金幣；營收依指定公式，未扣活動與營運成本，非淨利。</p>`;
 const activeTotal=number(snapshot?.mau)?snapshot.mau:number(composition?.total)?composition.total:null;
 const snapshotThrough=date(snapshot?.through)||date(composition?.through);
 const kpi=(label,value,unit,sub)=>`<div class="si-kpi"><span>${label}</span><strong>${typeof value==='string'?value:num(value)}<small>${unit}</small></strong><p>${sub}</p></div>`;
 const kpis=`<section class="si-kpi-strip" aria-label="活躍與付費概況">${kpi('月活躍 MAU',activeTotal,'人',snapshotThrough?'截至 '+esc(short(snapshotThrough))+'，含該日':'月度去重快照待補')}${kpi('月付費 MPU',snapshot?.mpu??null,'人','月內去重付費人數')}${kpi('日均活躍 DAU',number(p.now?.dau)?num(p.now.dau,1):'—','人',dauChange!==null?'較同期 '+formatMove(dauChange):'依完整日平均')}${kpi('日付費率',percent(p.now?.payRate),'',number(p.now?.payRate)?'付費人次／活躍人次':'日報資料待補')}</section>`;
 const comp=composition,total=comp?.total,old=comp?.existing,fresh=comp?.newRegistered;
 const validComp=number(total)&&total>=0&&number(old)&&old>=0&&number(fresh)&&fresh>=0&&old+fresh===total&&date(comp.through)===snapshotThrough&&(!number(activeTotal)||activeTotal===total);
 const compositionHtml=validComp?`<div class="si-composition"><span>活躍組成</span><div class="si-composition-bar" role="img" aria-label="既有活躍${num(old)}人，新註冊活躍${num(fresh)}人"><i style="width:${total?old/total*100:0}%"></i><b style="width:${total?fresh/total*100:0}%"></b></div><span>既有 <b>${num(old)}</b> · ${percent(total?old/total:null)}</span><span>當月新註冊 <b>${num(fresh)}</b> · ${percent(total?fresh/total:null)}</span></div>`:'<div class="si-composition pending"><span>活躍組成</span><span class="si-pending-dot"></span><p>新註冊活躍／既有活躍分群待補</p><small>註冊人數不代替活躍</small></div>';
 const yearRows=D.monthly.filter(x=>x.platform===key&&x.month.startsWith(String(state.year)));
 const yearMonths=Array.from({length:12},(_,i)=>state.year+'-'+String(i+1).padStart(2,'0'));
 const yearValues=yearMonths.map(m=>yearRows.find(x=>x.month===m)?.reportDeposit??null);
 const estimate=(direction,coins)=>number(coins)&&typeof coinAmount==='function'?coinAmount(key,direction,coins):null;
 // A monthly merchant point needs an explicit query range, aligned with the
 // cash month shown alongside it. Old months with no merchant source stay null.
 const monthlyFunding=m=>{
  const cashEnd=date(yearRows.find(x=>x.month===m)?.through);
  return (D.funding||[]).filter(x=>x.platform===key&&x.month===m&&x.covered!==false&&date(x.from)===m+'-01'&&date(x.to)?.startsWith(m)&&(!cashEnd||date(x.to)===cashEnd)).sort((a,b)=>date(b.to).localeCompare(date(a.to)))[0]||null;
 };
 const annualFunding=yearMonths.map(monthlyFunding);
 const annualBuy=annualFunding.map(x=>x?estimate('buy',x.buyCoins):null);
 const annualSell=annualFunding.map(x=>x?estimate('sell',x.sellCoins):null);
 const selectedAnnual=monthlyFunding(month);
 const selectedAnnualCash=yearRows.find(x=>x.month===month)?.reportDeposit??null;
 const dailyFunding=(D.fundingDaily||[]).filter(x=>x.platform===key&&date(x.date));
 const currentFunding=dailyFunding.filter(x=>date(x.date).startsWith(month));
 const nowDailyFund=new Map(currentFunding.map(x=>[Number(date(x.date).slice(8)),x]));
 const previousDailyFund=new Map(dailyFunding.filter(x=>date(x.date).startsWith(prevMonth(month))).map(x=>[Number(date(x.date).slice(8)),x]));
 const dailyEstimate=(record,direction)=>{
  if(!record)return null;
  // Recompute from original coins with the current shared policy. Persisted
  // derived amounts may belong to an earlier build's conversion settings.
  return estimate(direction,record[direction+'Coins']);
 };
 const dayCount=Math.max(p.day||0,p.fullMonth?p.previousDay||0:0,...currentFunding.map(x=>Number(date(x.date).slice(8))),0);
 const dayNumbers=Array.from({length:dayCount},(_,i)=>i+1);
 const nowCashByDay=new Map(p.a.map(r=>[Number(r[0].slice(8)),r[4]]));
 const previousCashByDay=new Map(daily(key,prevMonth(month)).map(r=>[Number(r[0].slice(8)),r[4]]));
 const dailyCash=dayNumbers.map(d=>nowCashByDay.get(d)??null);
 const dailyPreviousCash=dayNumbers.map(d=>previousCashByDay.get(d)??null);
 const dailyBuy=dayNumbers.map(d=>dailyEstimate(nowDailyFund.get(d),'buy'));
 const dailyPreviousBuy=dayNumbers.map(d=>dailyEstimate(previousDailyFund.get(d),'buy'));
 const dailySell=dayNumbers.map(d=>dailyEstimate(nowDailyFund.get(d),'sell'));
 const dailyPreviousSell=dayNumbers.map(d=>dailyEstimate(previousDailyFund.get(d),'sell'));
 const hasCurrentDaily=[...dailyCash,...dailyBuy,...dailySell].some(number);
 const completeSum=values=>values.length&&values.every(number)?values.reduce((s,v)=>s+v,0):null;
 const readouts=(cash,buyAmount,sellAmount)=>`<div class="si-kpi-strip si-chart-readouts" style="grid-template-columns:repeat(3,minmax(0,1fr));padding:10px 0;margin-bottom:16px">${[['官儲／現金',cash],['買幣／估算額',buyAmount],['賣幣／估算額',sellAmount]].map(([label,value])=>`<div class="si-kpi" style="padding:0 10px"><span style="font-size:11px">${label}</span><strong style="font-size:clamp(16px,1.7vw,23px)">${num(value,number(value)&&!Number.isInteger(value)?2:0)}</strong></div>`).join('')}</div>`;
 const aligned=p.a.map(r=>({row:r,before:p.b.find(b=>b[0].slice(8)===r[0].slice(8))?.[4]})).filter(x=>number(x.row[4])&&number(x.before));
 const biggest=[...aligned].sort((a,b)=>Math.abs(b.row[4]-b.before)-Math.abs(a.row[4]-a.before))[0];
 const dayInsight=biggest?`官儲最大日差：${short(biggest.row[0])} ${biggest.row[4]>=biggest.before?'增加':'減少'} ${num(Math.abs(biggest.row[4]-biggest.before))} 現金。`:'官儲最大日差待完整逐日對照。';
 const chartPanel=(title,subtitle,body,foot,action)=>`<section class="si-chart-panel"><header><div><span class="si-section-kicker">${subtitle}</span><h3>${title}</h3></div><button data-go="${action}">明細 ↗</button></header>${body}<p class="si-chart-caption">${foot}</p></section>`;
 const annualCoverage=annualFunding.filter(Boolean).map(x=>period(date(x.to))).join('、');
 const annualContent=readouts(selectedAnnualCash,selectedAnnual?estimate('buy',selectedAnnual.buyCoins):null,selectedAnnual?estimate('sell',selectedAnnual.sellCoins):null)+chart([{name:'官儲（現金）',color:'#d1bb88',values:yearValues},{name:'買幣（估算額）',color:'#89b69e',values:annualBuy},{name:'賣幣（估算額）',color:'#7d9fbe',values:annualSell}],Array.from({length:12},(_,i)=>(i+1)+'月'),{height:285,format:v=>num(v/10000,0)+'萬',clicks:true});
 const currentPlotDays=p.fullMonth?p.day:dayCount;
 const dailyContent=hasCurrentDaily?readouts(completeSum(dailyCash.slice(0,currentPlotDays)),completeSum(dailyBuy.slice(0,currentPlotDays)),completeSum(dailySell.slice(0,currentPlotDays)))+chart([{name:'官儲本月（現金）',color:'#d1bb88',values:dailyCash},{name:'官儲前月（現金）',color:'#d1bb88',dash:'4 4',values:dailyPreviousCash},{name:'買幣本月（估算額）',color:'#89b69e',values:dailyBuy},{name:'買幣前月（估算額）',color:'#89b69e',dash:'4 4',values:dailyPreviousBuy},{name:'賣幣本月（估算額）',color:'#7d9fbe',values:dailySell},{name:'賣幣前月（估算額）',color:'#7d9fbe',dash:'4 4',values:dailyPreviousSell}],dayNumbers.map(d=>String(d).padStart(2,'0')),{height:285,format:v=>num(v/10000,1)+'萬'}):'<div class="si-chart-empty">當月逐日紀錄待補，尚不繪製每日趨勢。</div>';
 const charts=`<div class="si-chart-grid">${chartPanel('年度官儲與買賣幣',state.year+' · 上方讀數為 '+Number(month.slice(5))+' 月',annualContent,'官儲為現金，買賣幣依指定比率換算；營收另依指定公式計算，非淨利。買賣幣覆蓋：'+esc(annualCoverage||'期間明細待補')+'；其他月份留白。點選月份可深入。','monthly')}${chartPanel('每日官儲與買賣幣對照',hasCurrentDaily?(p.fullMonth?'本月 '+p.day+' 日、前月 '+p.previousDay+' 日；按日序呈現，虛線為前月':'本月與前月同日序 1–'+dayCount+' 日；虛線為前月'):'當月逐日紀錄待補',dailyContent,esc(dayInsight)+' 官儲為現金，買賣幣為估算額；缺日及不存在日期留白，完整範圍不足時總額留空，圖例可切換。','monthly')}</div>`;
 const registrationSource=registrationForPeriod(key,month+'-01',through),registrations=registrationSource?.newRegistered??null,newThrough=date(registrationSource?.through),newData=overviewNewCustomerPeriod(key,month,month+'-01',through,registrationSource),newDataAligned=!!newData;
 const newConversion=newDataAligned&&number(newData?.conversionRate)?newData.conversionRate:null;
 const followCount=noFunding?noFunding.length:cohortData?unpaid.length:null,followLabel=noFunding?'尚未再補入':'尚未再次官儲';
 const summary=`<section class="si-player-section"><header><div><span class="si-section-kicker">從整體走到玩家</span><h2>下一步，從哪裡查起</h2></div><span>來源、回購、逐人差額</span></header><div class="si-player-grid">
 <article class="si-player-card"><div class="si-player-top"><h3>新客表現</h3><span>01</span></div><div class="si-player-number">${num(registrations)}<small>位新註冊</small></div><div class="si-player-line"><span>同期註冊且付費</span><b>${num(newDataAligned?newData?.firstPayers:null)} 人</b></div><div class="si-player-line"><span>註冊 → 付費</span><b>${percent(newConversion)}</b></div><p>看註冊來自哪個渠道，以及是否轉成付費。</p><button data-go="new">查看來源渠道 <span>→</span></button><small class="si-player-period">創號日期報表 · ${esc(period(newThrough))}；${newDataAligned?'同期官儲轉換已核對':'付費轉換需同範圍會員來源'}</small></article>
 <article class="si-player-card"><div class="si-player-top"><h3>既有付費回購</h3><span>02</span></div><div class="si-player-number">${percent(returnRate)}<small>本月官儲回購率</small></div><div class="si-retention-track" role="img" aria-label="${cohortData?num(repaid.length)+'／'+num(cohortRows.length)+'人回購':'回購母體待補'}"><i style="width:${returnRate===null?0:returnRate*100}%"></i></div><div class="si-player-line"><span>前月付費 → 本月再官儲</span><b>${cohortData?num(repaid.length)+' / '+num(cohortRows.length):'—'} 人</b></div><p>對照前月付費母體，追查回購人數與金額。</p><button data-go="retention">核對回購玩家 <span>→</span></button><small class="si-player-period">前月直接付費者 · 截至 ${esc(cohortData?.cutoff||'待補')}</small></article>
 <article class="si-player-card si-player-follow"><div class="si-player-top"><h3>需要追蹤的玩家</h3><span>03</span></div><div class="si-player-number">${num(followCount)}<small>位${followLabel}</small></div><div class="si-player-line"><span>未官儲，仍向幣商收幣</span><b>${shifted?num(shifted.length):'—'} 人</b></div><p>${noFunding?'先排除通路轉移，再逐一看 AID、暱稱與前後月金額。':'先列出尚未官儲的玩家；幣商紀錄不足時保留未知。'}</p><button data-go="retention">查看 AID 與金額差額 <span>→</span></button><small class="si-player-period">${cohortData?'母體 '+num(cohortRows.length)+' 人 · 截至 '+esc(cohortData.cutoff):'完整前後月付費名單待補'}</small></article>
 </div></section>`;
 return `<div class="single-intel">${brief}${flows}${kpis}${compositionHtml}<div class="si-data-caption"><span>月快照 ${snapshotThrough?esc(snapshotThrough)+'（含該日）':'待補'}</span><span>每日完整日 ${esc(period(dailyThrough))}</span></div>${charts}${summary}<div class="si-page-source">資料來自後台每日消費、月活躍、儲值排行與成功收贈禮。各區截止日分開標示，未回購尚不代表已離開平台。</div></div>`;
}
