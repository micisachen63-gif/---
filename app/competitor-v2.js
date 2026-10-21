/* Aggregate competitor views. Loaded alongside app.js; no member-level data. */
function cv2Finite(value){return typeof value==='number'&&Number.isFinite(value)?value:null;}
function cv2Ratio(a,b){return a!==null&&b!==null&&b!==0?a/b-1:null;}
function cv2Delta(a,b,d=0){return a===null||b===null?'—':(a-b>0?'+':'')+num(a-b,d);}
function cv2Date(value){return value?String(value).slice(0,10):'—';}
function cv2Summary(rows){
 if(!rows.length)return null;
 const sum=i=>rows.every(r=>cv2Finite(r[i])!==null)?rows.reduce((s,r)=>s+r[i],0):null;
 const cash=sum(4),active=sum(1),paid=sum(2);
 return{days:rows.length,cash,dau:active===null?null:active/rows.length,dpu:paid===null?null:paid/rows.length,transactions:sum(3),firstPayers:sum(8),firstCash:sum(9),payRate:active!==null&&paid!==null&&active!==0?paid/active:null};
}
function cv2DaysComplete(rows,month,days=19){const dates=new Set(rows.map(r=>r[0]));return rows.length===days&&Array.from({length:days},(_,i)=>month+'-'+String(i+1).padStart(2,'0')).every(d=>dates.has(d));}
function cv2Dates(from,through){const out=[];if(!/^\d{4}-\d{2}-\d{2}$/.test(from||'')||!/^\d{4}-\d{2}-\d{2}$/.test(through||'')||from>through)return out;for(let t=Date.parse(from);t<=Date.parse(through);t+=86400000)out.push(new Date(t).toISOString().slice(0,10));return out;}
function cv2Comparison(c){const configured=D.marketFundingComparisons?.period,n=c.normalizedComparison,m=c.normalizedMetrics,selected=configured?.currentFrom===state.month+'-01'?configured:n?.currentFrom===state.month+'-01'?n:m?.current?.from===state.month+'-01'?{previousFrom:m.prev?.from,previousThrough:m.prev?.to,currentFrom:m.current.from,currentThrough:m.current.to}:cv2MarketPeriod();return{...selected,ready:n?.ready!==false,days:cv2Dates(selected.currentFrom,selected.currentThrough).length};}
function cv2Range(from,through){return `${String(from||'—').replaceAll('-','/')} — ${String(through||'—').slice(5).replaceAll('-','/')}`;}
function cv2SourceRange(source){return cv2Range(source?.period?.from||source?.from,source?.period?.through||source?.period?.to||source?.through||source?.to);}
function cv2DailyPair(c){
 const period=cv2Comparison(c),byDate=new Map((c.normalizedDaily||[]).map(r=>[r[0],[...r]])),archive=(D.competitorArchives?.platforms||[]).find(r=>r.platform===c.key)||(D.competitorArchive?.platform===c.key?D.competitorArchive:null);
 for(const r of archive?.daily||[])if(cv2Finite(r.officialCash)!==null){const row=byDate.get(r.date)||[r.date,null,null,null,null,null,null,null,null,null];row[4]=r.officialCash;byDate.set(r.date,row);}
 for(const r of archive?.history?.operatingDaily||[])if(cv2Finite(r.dau)!==null){const row=byDate.get(r.date)||[r.date,null,null,null,null,null,null,null,null,null];row[1]=r.dau;byDate.set(r.date,row);}
 const rows=[...byDate.values()].sort((a,b)=>a[0].localeCompare(b[0])),previous=rows.filter(r=>r[0]>=period.previousFrom&&r[0]<=period.previousThrough),current=rows.filter(r=>r[0]>=period.currentFrom&&r[0]<=period.currentThrough),a=cv2Dates(period.previousFrom,period.previousThrough),b=cv2Dates(period.currentFrom,period.currentThrough),complete=(rows,dates)=>rows.length===dates.length&&dates.every(d=>rows.some(r=>r[0]===d));
 return{previous,current,period,valid:a.length>0&&b.length>0&&complete(previous,a)&&complete(current,b)};
}
function cv2GameValues(c,from,through){const source=Object.values(c.gameSummaries||{}).find(r=>{const p=r.period||{},q=r.queryProof,captured=Date.parse(r.capturedAt);return(p.from||r.from)===from&&(p.through||p.to||r.through)===through&&q?.verified===true&&q.selectedFrom===from&&q.selectedThrough===through&&Number.isFinite(captured)&&new Date(captured+8*3600000).toISOString().slice(0,10)>through;});if(!source)return null;return Object.values(c.normalizedMetrics||{}).find(r=>r&&r.from===from&&(r.to||r.through)===through)||null;}
function cv2Compared(c){
 const pair=cv2DailyPair(c),period=pair.period,daily=(D.marketFundingComparisons?.rows||[]).find(r=>r.platform===c.key)?.dailyMetrics;
 const value=(rows,source,from,through)=>{const snapshot=cv2Summary(rows)||{},dates=cv2Dates(from,through),full=dates.length>0&&rows.length===dates.length&&new Set(rows.map(r=>r[0])).size===dates.length&&dates.every(d=>rows.some(r=>r[0]===d)),cash=cv2MarketRows(rows,from,through,4),dau=cv2MarketRows(rows,from,through,1),exact=source?.from===from&&source?.through===through,game=cv2GameValues(c,from,through);return{...snapshot,transactions:full?cv2MarketRows(rows,from,through,3):null,firstPayers:full?cv2MarketRows(rows,from,through,8):null,firstCash:full?cv2MarketRows(rows,from,through,9):null,dpu:exact&&source.dpuComplete===true?cv2Finite(source.dpu):full?snapshot.dpu??null:null,cash:exact&&source.cashComplete===true&&cv2Finite(source.cash)!==null?source.cash:cash,dau:exact&&source.dauComplete===true&&cv2Finite(source.dau)!==null?source.dau:dau,newRegistered:cv2MarketRegistration(c,from,through),rtp:cv2Finite(game?.gameRTPPercent)};};
 const previous=value(pair.previous,daily?.previous,period.previousFrom,period.previousThrough),current=value(pair.current,daily?.current,period.currentFrom,period.currentThrough),complete=key=>cv2Finite(previous[key])!==null&&cv2Finite(current[key])!==null;
 return{previous,current,valid:complete('cash')&&complete('dau'),completeness:{cash:complete('cash'),dau:complete('dau'),registration:complete('newRegistered'),game:complete('rtp')}};
}
function cv2Details(title,body){return`<details class="cv2-details"><summary>${esc(title)} <span>展開明細 ＋</span></summary>${body}</details>`;}
function cv2Styles(){return`<style>.cv2-details{margin-top:18px;border-top:1px solid #29405a;padding-top:14px}.cv2-details summary{cursor:pointer;color:#d9ba75;font-size:13px;list-style:none;display:flex;justify-content:space-between;gap:16px}.cv2-details summary span{font:11px sans-serif;color:#8396ad}.cv2-details[open] summary{margin-bottom:18px}.cv2-kicker{color:#a48a56;letter-spacing:.16em;font-size:10px;margin:0 0 13px}.cv2-period{display:flex;align-items:center;justify-content:space-between;gap:18px;margin-bottom:20px;color:#a9b7c8;font-size:12px}.cv2-period strong{color:#eed493;font-weight:400}.cv2-benchmark .benchmark-line{display:grid;grid-template-columns:90px 1fr 75px;align-items:center;gap:13px;padding:11px 0;border-bottom:1px solid #20334b}.cv2-benchmark .benchmark-line:last-child{border-bottom:0}.cv2-benchmark .benchmark-track{height:12px;position:relative;background:#09182a;border-radius:2px}.cv2-benchmark .benchmark-track:before{content:'';position:absolute;left:50%;top:-5px;bottom:-5px;width:1px;background:#516078}.cv2-benchmark .benchmark-fill{position:absolute;height:6px;top:3px;border-radius:1px}.cv2-benchmark .benchmark-number{text-align:right;font:12px Georgia,serif}.cv2-benchmark .benchmark-name{font-size:12px}.cv2-benchmark .benchmark-line.own .benchmark-name{color:#eed493}.cv2-source-link{color:#bdcddd;overflow-wrap:anywhere;text-decoration:none}.cv2-source-link:hover{color:#e5c984}.cv2-meta{color:#8d9eb3;font:11px sans-serif;line-height:1.9}@media(max-width:600px){.cv2-period{display:block;line-height:1.9}.cv2-benchmark .benchmark-line{grid-template-columns:70px 1fr 65px;gap:8px}}</style>`;}
function cv2Annual(c){
 const months=(c.normalizedMonthly||[]).filter(m=>m.month.startsWith(String(state.year))),labels=Array.from({length:12},(_,i)=>(i+1)+'月'),values=labels.map((_,i)=>cv2Finite(months.find(m=>Number(m.month.slice(5))===i+1)?.deposit));
 const selected=months.find(m=>m.month===state.month);
 return panel('年度官儲軌跡',`${state.year} 年 · 點選月份查看 MAU、付費人數與每月明細`,chart([{name:'後台儲值原值',color:'#d9ba75',values}],labels,{format:v=>num(v/10000,0)+'萬',clicks:true})+`<p class="chart-note">${selected?esc(state.month+'：'+(selected.partial?'截至 '+selected.through+'，包含當日未完整數據':'完整月快照'))+'。':''} 月報與下方${cv2Comparison(c).days}日同期分析各自保留截止日。</p>`);
}
function cv2Kpis(c){
 const cmp=cv2Compared(c),period=cv2Comparison(c),p=cmp.previous,q=cmp.current,rtp=q?.rtp??null,oldRtp=p?.rtp??null;
 const rtpText=rtp===null?'—':num(rtp,2)+'%',rtpFoot=rtp===null?'遊戲彙總待取得':oldRtp===null?'派彩 / 總投注':Number(period.previousFrom.slice(5,7))+'月 '+num(oldRtp,2)+'% · '+cv2Delta(rtp,oldRtp,2)+' 個百分點';
 return`<div class="cv2-period"><div><span class="cv2-kicker">MATCHED PERIOD · ${period.days} DAYS</span><br><strong>${esc(cv2Range(period.currentFrom,period.currentThrough))}</strong>　對照　${esc(cv2Range(period.previousFrom,period.previousThrough))}</div><span>${cmp.completeness.cash&&cmp.completeness.dau?'官儲與活躍同期已核對':'官儲／活躍來源未齊，各指標獨立保留缺值'}${cmp.completeness.registration?'':' · 註冊待補'}${cmp.completeness.game?'':' · 遊戲來源核驗未齊'}</span></div><div class="metrics">${metric('官儲金額',q?.cash??null,'後台原值',q?.cash??null,p?.cash??null)}${metric('日均活躍',q?.dau??null,'日均人',q?.dau??null,p?.dau??null)}${metric('註冊人數',q?.newRegistered??null,'人',q?.newRegistered??null,p?.newRegistered??null)}${metric('RTP',rtpText,'派彩 / 投注',null,null,rtpFoot)}</div>`;
}
function cv2Narrative(c){
 const {previous:p,current:q,valid}=cv2Compared(c),period=cv2Comparison(c);
 if(!valid)return '<p class="fine">需要兩期完整日期後，才顯示同期落差。</p>';
 const cashChange=cv2Ratio(q.cash,p.cash),dauChange=cv2Ratio(q.dau,p.dau),nuChange=cv2Ratio(q.newRegistered,p.newRegistered);
 return`<div class="insight"><span class="n">01</span><div><strong>${cashChange===null?'官儲同期比較待補':'官儲較前月同期'+(cashChange>=0?'增加 ':'減少 ')+percent(Math.abs(cashChange))}</strong><p>${Number(period.previousFrom.slice(5,7))}月 ${num(p.cash)} → ${Number(period.currentFrom.slice(5,7))}月 ${num(q.cash)}，差額 ${cv2Delta(q.cash,p.cash)}。均為後台儲值原值。</p></div></div><div class="insight"><span class="n">02</span><div><strong>${dauChange===null?'活躍變化待補':'日均活躍'+(dauChange>=0?'上升 ':'下降 ')+percent(Math.abs(dauChange))}</strong><p>註冊人數 ${num(p.newRegistered)} → ${num(q.newRegistered)}${nuChange===null?'':'（'+(nuChange>=0?'+':'')+percent(nuChange)+'）'}；註冊人數與活躍人數分開衡量。</p></div></div><div class="insight"><span class="n">03</span><div><strong>付費強度與玩家數一起看</strong><p>日均付費人次 ${num(p.dpu,1)} → ${num(q.dpu,1)}，交易筆數 ${num(p.transactions)} → ${num(q.transactions)}。個別會員流失需另有會員資料才能確認。</p></div></div>`;
}
function cv2DailyCharts(c){
 const p=cv2DailyPair(c),labels=Array.from({length:p.period.days},(_,i)=>String(i+1)),values=(rows,index,from)=>labels.map((_,i)=>cv2Finite(rows.find(r=>r[0]===new Date(Date.parse(from)+i*86400000).toISOString().slice(0,10))?.[index])),caption=cv2Range(p.period.previousFrom,p.period.previousThrough)+' 對照 '+cv2Range(p.period.currentFrom,p.period.currentThrough);
 return`<div class="grid-equal">${panel('每日官儲對照',caption+'；後台儲值原值，逐日缺值保留空白',chart([{name:'本期',color:'#d9ba75',values:values(p.current,4,p.period.currentFrom)},{name:'前期',color:'#6687a6',values:values(p.previous,4,p.period.previousFrom)}],labels,{format:v=>num(v/10000,1)+'萬'}))}${panel('每日活躍對照','DAU · 每日不重複登入人數 · '+p.period.days+'日',chart([{name:'本期',color:'#d9ba75',values:values(p.current,1,p.period.currentFrom)},{name:'前期',color:'#6687a6',values:values(p.previous,1,p.period.previousFrom)}],labels,{format:v=>num(v)}))}</div>`;
}
function cv2GamePanel(c){
 const {previous:p,current:q}=cv2Compared(c),period=cv2Comparison(c),prior=cv2GameValues(c,period.previousFrom,period.previousThrough),current=cv2GameValues(c,period.currentFrom,period.currentThrough);
 const gameRows=[['總投注額',prior?.gameTotalBet,current?.gameTotalBet],['總派彩',prior?.gamePayout,current?.gamePayout],['遊戲淨利',prior?.gameNet,current?.gameNet]];
 const units=c.gameSummaries?.oct?.units||c.gameSummaries?.sep?.units||'遊戲金幣／點數';
 return panel('遊戲端的變化','RTP與投注、派彩採各自核驗的同期遊戲彙總',`<div class="comparison-grid"><div class="comparison-cell"><span>前期 RTP · ${esc(cv2Range(period.previousFrom,period.previousThrough))}</span><strong>${p?.rtp===null||p?.rtp===undefined?'—':num(p.rtp,2)+'%'}</strong></div><div class="comparison-cell"><span>本期 RTP · ${esc(cv2Range(period.currentFrom,period.currentThrough))}</span><strong>${q?.rtp===null||q?.rtp===undefined?'—':num(q.rtp,2)+'%'}</strong></div></div><p class="fine">${esc(units)}。遊戲淨利是投注減派彩，與現金官儲分開閱讀。</p>`+cv2Details('投注、派彩與遊戲淨利',table(['遊戲指標',cv2Range(period.previousFrom,period.previousThrough),cv2Range(period.currentFrom,period.currentThrough),'原值差額'],gameRows.map(([label,a,b])=>row([esc(label),num(a,2),num(b,2),cv2Delta(cv2Finite(b),cv2Finite(a),2)])))));
}
function cv2Monthly(c){
 if(typeof monthlyV2==='function')return monthlyV2(c.key,state.month);
 const months=(c.normalizedMonthly||[]).filter(m=>m.month.startsWith(String(state.year))),selected=months.find(m=>m.month===state.month),dailyRows=(c.normalizedDaily||[]).filter(r=>r[0].startsWith(state.month));
 const matrix=`<div class="matrix">${Array.from({length:12},(_,i)=>{const key=state.year+'-'+String(i+1).padStart(2,'0'),m=months.find(x=>x.month===key);return`<button class="${key===state.month?'active':''} ${m?'':'missing'}" data-select-month="${key}">${i+1}月<span>${m&&m.deposit!==null?num(m.deposit/10000,1)+'萬':'—'}</span></button>`;}).join('')}</div>`;
 const detail=selected?`<div class="cv2-period"><strong>${esc(selected.month)} · ${selected.partial?'截至 '+esc(selected.through||'採集當下')+'，含當日未完整數據':'完整月'}</strong><span>來源：玩家消費（月）／玩家活躍（月）</span></div><div class="metrics">${metric('每月官儲',selected.deposit,'後台原值')}${metric('月活躍 MAU',selected.mau,'去重人數')}${metric('月付費 MPU',selected.mpu,'去重人數')}${metric('月付費率',percent(selected.payRate),'MPU / MAU')}</div><div class="comparison-grid"><div class="comparison-cell"><span>ARPU · 官儲 / MAU</span><strong>${num(selected.arpu,2)}</strong></div><div class="comparison-cell"><span>ARPPU · 官儲 / MPU</span><strong>${num(selected.arppu,2)}</strong></div><div class="comparison-cell"><span>首次付費人數</span><strong>${num(selected.firstPayers)}</strong></div><div class="comparison-cell"><span>首付當筆金額</span><strong>${num(selected.firstCash)}</strong></div></div>`:'<p class="fine">此月尚無後台月報快照。</p>';
 const monthlyTable=cv2Details('全年每月具體數值',table(['月份','官儲原值','MAU','MPU','付費率','ARPU','ARPPU','首付人數','資料範圍'],months.map(m=>row([`<button data-select-month="${esc(m.month)}">${esc(m.month)}</button>`,num(m.deposit),num(m.mau),num(m.mpu),percent(m.payRate),num(m.arpu,2),num(m.arppu,2),num(m.firstPayers),esc(m.partial?'截至 '+(m.through||'採集當下'):'整月')]))));
 const dailyTable=dailyRows.length?cv2Details(state.month+' 已取得的每日數值',table(['日期','官儲原值','DAU','每日付費人數','付費率','交易筆數','首付人數','首付當筆金額'],dailyRows.map(r=>row([esc(r[0]),num(r[4]),num(r[1]),num(r[2]),percent(r[5]===null?null:r[5]/100),num(r[3]),num(r[8]),num(r[9])])))):'<p class="source-note">此月每日明細尚未擷取，以上月報數值仍可閱讀。</p>';
 return cv2Annual(c)+panel('逐月深入',`${state.year} 年 · 選擇月份`,matrix+detail+monthlyTable+dailyTable)+sourceNote('月報含採集時的當日進度；每日已取得範圍 '+(c.normalizedDaily?.[0]?.[0]||'待補')+' — '+(c.normalizedDaily?.at(-1)?.[0]||'待補')+'，缺日保留空缺。兩種快照不混作相同截止日。');
}
function cv2Sources(c){
 const dailyRows=c.normalizedDaily||[],monthly=c.normalizedMonthly||[],last=monthly.at(-1),comparison=cv2Comparison(c),groups=[['每日官儲、DAU、每日付費',dailyRows[0]?.[0]&&dailyRows.at(-1)?.[0]?dailyRows[0][0]+' — '+dailyRows.at(-1)[0]:'待取得',c.consumeDaily?.sourceUrl,c.consumeDaily?.capturedAt],['每月 MPU / ARPU / 官儲',monthly.length?monthly[0].month+' — '+last.month:'待取得',c.consumeMonthly?.sourceUrl,c.consumeMonthly?.capturedAt],['每月 MAU',monthly.length?monthly[0].month+' — '+last.month:'待取得',c.activeMonthly?.sourceUrl,c.activeMonthly?.capturedAt]];
 for(const [side,label] of [['sep','前期'],['oct','本期']])for(const [kind,name] of [['newRegistrations','註冊'],['gameSummaries','遊戲投注、派彩、RTP']]){const source=c[kind]?.[side];groups.push([label+name,cv2SourceRange(source),source?.sourceUrl,source?.capturedAt]);}
 return panel('來源與可見範圍',c.name+' · 後台直接產出',table(['資料集','查詢期間','來源頁面','採集時間（UTC）'],groups.map(([label,period,url,time])=>row([esc(label),esc(period),url?`<a class="cv2-source-link" href="${esc(url)}" target="_blank" rel="noopener noreferrer">${esc(new URL(url).pathname)}</a>`:'—',esc(time||'—')]))))+panel('閱讀口徑','保持同期間、同指標與同單位',`<div class="timeline"><div class="timeline-item"><time>前期 → 本期</time><p>總覽比較 ${esc(cv2Range(comparison.previousFrom,comparison.previousThrough))} 與 ${esc(cv2Range(comparison.currentFrom,comparison.currentThrough))}；${Object.values(cv2Compared(c).completeness).every(Boolean)?'各指標期間核驗通過':'各指標獨立核驗；缺註冊或遊戲來源不阻擋已核對的官儲與活躍'}。年度月報10月${last?.partial?'截至 '+esc(last.through||'採集當下')+'，包含當天進度':'依月報範圍'}。</p></div><div class="timeline-item"><time>官儲與遊戲分開</time><p>官儲為後台儲值原值。遊戲投注與淨利維持原遊戲單位，尚未核實跨站點數倍率。</p></div><div class="timeline-item"><time>聚合指標觀測</time><p>可讀營運KPI；會員個資、活動設置未取得，因此不推算個人流失、活動ROI或個別玩家原因。</p></div></div>`);
}
function competitorViewV2(c){
 const section=state.section;
 if(section==='sources')return cv2Styles()+coinPolicyPanel(c.key)+cv2Sources(c);
 if(section==='monthly')return cv2Styles()+cv2Monthly(c);
 const observed=cv2Compared(c).current,missingCurrent=['cash','dau','newRegistered','rtp'].every(k=>cv2Finite(observed[k])===null);return cv2Styles()+(missingCurrent?'<div class="notice">'+esc(state.month)+' 尚無可核對的本月同期資料；不沿用其他月份指標。</div>':'')+cv2Kpis(c)+coinPolicyPanel(c.key)+`<div class="grid2">${cv2Annual(c)}${panel('同期關鍵觀察','將官儲、活躍與新客分開閱讀',cv2Narrative(c))}</div>`+cv2DailyCharts(c)+cv2GamePanel(c)+sourceNote(`${c.name}後台玩家消費日報、玩家總覽與機台總覽；同期 ${cv2Range(cv2Comparison(c).previousFrom,cv2Comparison(c).previousThrough)} 對照 ${cv2Range(cv2Comparison(c).currentFrom,cv2Comparison(c).currentThrough)}。會員、活動與遊戲明細依實際權限及來源完整度各自標示。`);
}

function cv2OwnNU(platform,month,days=19){
 const from=month+'-01',through=month+'-'+String(days).padStart(2,'0');
 if(typeof registrationForPeriod==='function')return cv2Finite(registrationForPeriod(platform,from,through)?.newRegistered);
 const sources=(D.registrationPeriods||[]).filter(r=>r.platform===platform&&r.from===from&&r.through===through&&r.complete===true&&r.validation?.valid===true&&Number.isInteger(r.newRegistered)&&r.newRegistered>=0&&Number.isFinite(Date.parse(r.capturedAt))).sort((a,b)=>Date.parse(b.capturedAt)-Date.parse(a.capturedAt));
 return sources.length?sources[0].newRegistered:null;
}
function cv2MarketPeriod(){
 const month=state.month,configured=D.marketFundingComparisons?.period;
 if(configured?.currentFrom===month+'-01'&&cv2Dates(configured.currentFrom,configured.currentThrough).length&&cv2Dates(configured.previousFrom,configured.previousThrough).length)return{...configured};
 const end=m=>new Date(Date.UTC(Number(m.slice(0,4)),Number(m.slice(5)),0)).toISOString().slice(0,10),previous=prevMonth(month),captured=Date.parse(D.generatedAt),today=Number.isFinite(captured)?new Date(captured+8*3600000).toISOString().slice(0,10):null;
 const through=today?.startsWith(month)?new Date(Date.parse(today)-86400000).toISOString().slice(0,10):end(month),days=Number(through.slice(8));
 return{previousFrom:previous+'-01',previousThrough:through===end(month)?end(previous):previous+'-'+String(Math.min(days,Number(end(previous).slice(8)))).padStart(2,'0'),currentFrom:month+'-01',currentThrough:through};
}
function cv2MarketRate(current,previous){return cv2Finite(current)!==null&&cv2Finite(previous)!==null&&previous>0?current/previous-1:null;}
function cv2MarketRows(rows,from,through,index){
 const expected=cv2Dates(from,through),selected=rows.filter(r=>r[0]>=from&&r[0]<=through);
 return expected.length&&selected.length===expected.length&&new Set(selected.map(r=>r[0])).size===expected.length&&expected.every(date=>selected.some(r=>r[0]===date))&&selected.every(r=>cv2Finite(r[index])!==null)?selected.reduce((s,r)=>s+r[index],0)/(index===1?selected.length:1):null;
}
function cv2MarketRegistration(c,from,through){
 const n=c.normalizedComparison,m=c.normalizedMetrics,side=n?.currentFrom===from&&n?.currentThrough===through?'current':n?.previousFrom===from&&n?.previousThrough===through?'prev':null;
 if(side&&n?.ready!==false&&m?.[side]?.from===from&&m?.[side]?.to===through)return cv2Finite(m[side].newRegistered);
 for(const r of Object.values(c.newRegistrations||{})){const p=r.period||{},q=r.queryProof;if(p.from===from&&(p.through||p.to)===through&&q?.verified===true&&q.selectedFrom===from&&q.selectedThrough===through)return cv2Finite(r.newRegistered);}
 return null;
}
function cv2MarketFunding(platform,period,own){
 const aligned=r=>r&&r.from===period.currentFrom&&r.through===period.currentThrough&&r.prevFrom===period.previousFrom&&r.prevThrough===period.previousThrough;
 const rows=D.marketFundingComparisons?.rows||[],explicit=rows.find(r=>r.platform===platform&&aligned(r));
 // Only exact windows are usable. A full September snapshot cannot stand in
 // for September 1–20, and o8's seven-day scenario never fills a monthly pair.
 const record=explicit||(D.funding||[]).find(r=>r.platform===platform&&aligned(r));
 const currentKnown=record?.covered===true,previousKnown=record?.previousCovered===true||record?.previousMerchantCovered===true;
 const amount=(raw,direction)=>typeof coinAmount==='function'&&cv2Finite(raw)!==null?cv2Finite(coinAmount(platform,direction,raw)):null;
 const current={buy:currentKnown?amount(record.buyCoins,'buy'):null,sell:currentKnown?amount(record.sellCoins,'sell'):null},previous={buy:previousKnown?amount(record.prevBuyCoins,'buy'):null,sell:previousKnown?amount(record.prevSellCoins,'sell'):null};
 return{current,previous,identity:own?'已確認幣商':'候選情境',sourceFiles:record?.sourceFiles||[],previousSourceFiles:record?.previousSourceFiles||[],capturedAt:record?.capturedAt??null,previousCapturedAt:record?.previousCapturedAt??null};
}
function cv2BenchmarkItems(period=cv2MarketPeriod()){
 const own=(D.platforms||[]).map(p=>({key:p.key,name:p.name,own:true,rows:D.daily?.[p.key]||[],source:p.url+'statements/player-summary'}));
 const competitors=(D.competitors||[]).map(c=>({key:c.key,name:c.name,own:false,rows:c.normalizedDaily||[],c,source:c.consumeDaily?.sourceUrl||c.url}));
 return [...own,...competitors].map(item=>{
  const {currentFrom, currentThrough,previousFrom,previousThrough}=period,rows=item.rows;
  const previous={cash:cv2MarketRows(rows,previousFrom,previousThrough,4),dau:cv2MarketRows(rows,previousFrom,previousThrough,1)},current={cash:cv2MarketRows(rows,currentFrom,currentThrough,4),dau:cv2MarketRows(rows,currentFrom,currentThrough,1)};
  // Archive cash and DAU have independent provenance and coverage. They may
  // supplement a matching daily measure, never a different-period aggregate.
  const archive=(D.competitorArchives?.platforms||[]).find(a=>a.platform===item.key)||(D.competitorArchive?.platform===item.key?D.competitorArchive:null);
  if(!item.own&&archive){for(const [target,from,to]of [[current,currentFrom,currentThrough],[previous,previousFrom,previousThrough]]){
   if(target.cash===null)target.cash=cv2MarketRows((archive.daily||[]).map(r=>[r.date,null,null,null,r.officialCash]),from,to,4);
   if(target.dau===null)target.dau=cv2MarketRows((archive.history?.operatingDaily||[]).map(r=>[r.date,r.dau]),from,to,1);
  }}
  const dailyMetrics=(D.marketFundingComparisons?.rows||[]).find(r=>r.platform===item.key)?.dailyMetrics;
  for(const [target,source,from,through]of [[current,dailyMetrics?.current,currentFrom,currentThrough],[previous,dailyMetrics?.previous,previousFrom,previousThrough]]){
   if(source?.from!==from||source?.through!==through)continue;
   if(source.cashComplete===true&&cv2Finite(source.cash)!==null)target.cash=source.cash;
   if(source.dauComplete===true&&cv2Finite(source.dau)!==null)target.dau=source.dau;
  }
  previous.nu=item.own?cv2OwnNU(item.key,previousFrom.slice(0,7),Number(previousThrough.slice(8))):cv2MarketRegistration(item.c,previousFrom,previousThrough);
  current.nu=item.own?cv2OwnNU(item.key,currentFrom.slice(0,7),Number(currentThrough.slice(8))):cv2MarketRegistration(item.c,currentFrom,currentThrough);
  const fund=cv2MarketFunding(item.key,period,item.own);Object.assign(current,fund.current);Object.assign(previous,fund.previous);
  return{...item,rows:undefined,c:undefined,current,previous,fund,valid:current.cash!==null&&previous.cash!==null,cash:cv2MarketRate(current.cash,previous.cash),dau:cv2MarketRate(current.dau,previous.dau),nu:cv2MarketRate(current.nu,previous.nu),buy:cv2MarketRate(current.buy,previous.buy),sell:cv2MarketRate(current.sell,previous.sell),through:currentThrough,period};
 });
}
function cv2MarketChange(current,previous){
 if(current===null||previous===null)return '<span class="market-missing">同期資料待補</span>';
 if(previous<=0)return '<span class="market-missing">'+(previous===0?'前期為 0 · 看差額':'前期為負 · 看差額')+'</span>';
 const v=cv2MarketRate(current,previous);return '<span class="'+(v<0?'down':'up')+'">'+(v>0?'+':'')+percent(v)+'</span>';
}
function cv2Diverging(items,key){
 const max=Math.max(.1,...items.map(i=>Math.abs(cv2Finite(i[key])??0))),money=['cash','buy','sell'].includes(key);
 return`<div class="cv2-benchmark market-benchmark-list">${items.map(i=>{const v=cv2Finite(i[key]),width=v===null?0:Math.min(49,Math.abs(v)/max*48),color=i.key==='win'?'#dfc58a':i.own?'#8aafc8':'#a99a7b',current=i.current?.[key]??null,previous=i.previous?.[key]??null;return`<div class="benchmark-line ${i.own?'own':''}" data-market-site="${esc(i.key)}" data-market-metric="${esc(key)}"><span class="benchmark-name">${esc(i.name)}${['buy','sell'].includes(key)?`<small>${i.own?'已確認幣商':'候選情境'}</small>`:''}</span><div class="benchmark-track">${v===null?'':`<div class="benchmark-fill" style="left:${v<0?50-width:50}%;width:${width}%;background:${color}"></div>`}</div><span class="benchmark-number">${cv2MarketChange(current,previous)}</span><div class="market-values"><span>前 ${num(previous,money?2:1)} → 本 ${num(current,money?2:1)}</span><b>${current===null||previous===null?'差額 —':cv2Delta(current,previous,money?2:1)}</b></div></div>`;}).join('')}</div>`;
}
function cv2MarketStyles(){return`<style>.market-benchmark-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:22px}.market-benchmark-card{background:linear-gradient(150deg,rgba(24,47,72,.65),rgba(8,23,40,.7));border:1px solid #2b4158;border-radius:12px;padding:22px;min-width:0}.market-benchmark-card header{display:flex;justify-content:space-between;gap:12px;align-items:center;margin-bottom:12px}.market-benchmark-card h3{margin:0;font-size:17px;font-weight:600;color:#e6d3a6}.market-benchmark-card header>span{font-size:11px;color:#94a9bc}.market-benchmark-card>p{font-size:12px;line-height:1.7;color:#97a9bb;margin:0 0 8px}.market-benchmark-list .benchmark-line{grid-template-columns:76px minmax(25px,1fr) 104px;gap:7px 10px;padding:12px 0}.market-benchmark-list .benchmark-number{font:12px 'Segoe UI',Arial,sans-serif}.market-benchmark-list .benchmark-name{font-size:13px;color:#d7e0e8}.market-benchmark-list .benchmark-name small{display:block;font-size:10px;color:#8f9fac;margin-top:4px}.market-values{grid-column:2 / 4;display:flex;justify-content:space-between;gap:12px;color:#94a9bc;font:11px 'Segoe UI',Arial,sans-serif;flex-wrap:wrap}.market-values b{color:#becad6;font-weight:500}.market-missing{color:#7f93a6;font-size:11px}.market-benchmark-scope{display:flex;flex-wrap:wrap;gap:8px 20px;font-size:12px;color:#a9bbcc;margin-bottom:18px}.market-benchmark-scope strong{color:#e5ce9b;font-weight:500}.market-funding-evidence{font-size:11px;line-height:1.8;color:#99aec1}.market-funding-evidence p{margin:10px 0}.market-benchmark-note{font-size:12px;line-height:1.8;color:#99aec1;margin:14px 0 0}@media(max-width:1100px){.market-benchmark-grid{grid-template-columns:1fr}.market-benchmark-card{padding:18px}}@media(max-width:480px){.market-benchmark-list .benchmark-line{grid-template-columns:68px minmax(20px,1fr) 90px;gap:6px}.market-values{font-size:10px}.market-benchmark-card{padding:14px}.market-benchmark-card h3{font-size:16px}}</style>`;}
function competitorBenchmarkPanel(){
 const period=cv2MarketPeriod(),items=cv2BenchmarkItems(period),win=items.find(i=>i.key==='win'),peers=items.filter(i=>!i.own&&i.cash!==null),moreNegative=cv2Finite(win?.cash)!==null&&peers.length?peers.filter(i=>win.cash<i.cash).length:null;
 const caption=win?.cash===null||win?.cash===undefined?'依相同完整日期比較已取得產品。':`贏麻了官儲 ${percent(win.cash)}${moreNegative===peers.length&&peers.length?'，降幅高於'+peers.length+'個已觀測競品':'；與各站同期變化一起閱讀'}。`;
 const metricCards=[['cash','官儲變化','後台現金原值','官儲與買賣幣分開呈現。'],['dau','日均活躍變化','人／日','每日去重活躍的日平均，未跨站去重。'],['buy','買幣變化','指定比率換算 · 台幣','幣商／候選 → 外部玩家；排除名單內轉及已排除角色。'],['sell','賣幣變化','指定比率換算 · 台幣','外部玩家 → 幣商／候選；方向相反，分開比較。']].map(([key,title,unit,desc])=>`<article class="market-benchmark-card"><header><h3>${title}</h3><span>${unit}</span></header><p>${desc}</p>${cv2Diverging(items,key)}</article>`).join('');
 const financialRows=items.flatMap(i=>['buy','sell'].map(key=>row([esc(i.name),i.own?'已確認幣商':'候選情境 · 非正式營收',key==='buy'?'買幣':'賣幣',num(i.previous[key],2),num(i.current[key],2),cv2Delta(i.current[key],i.previous[key],2),cv2MarketChange(i.current[key],i.previous[key]),esc(typeof coinRuleLabel==='function'?coinRuleLabel(i.key,key):'換算比率待補')])));
 const sources=items.map(i=>`<p><b>${esc(i.name)}</b> · 前期 ${esc(i.fund.previousCapturedAt||'尚未取得')} ／ 本期 ${esc(i.fund.capturedAt||'尚未取得')}<br>${esc([...i.fund.previousSourceFiles,...i.fund.sourceFiles].map(f=>typeof f==='string'?f:f.file||'').filter(Boolean).join('、')||'同期間收贈禮來源待補')}</p>`).join('');
 return cv2Styles()+cv2MarketStyles()+panel('市場同期對照','六個自有站點 × 六個競品 · 官儲、活躍與買賣幣一起看',`<div class="market-benchmark-scope"><span>前期 <strong>${esc(cv2Range(period.previousFrom,period.previousThrough))}</strong></span><span>本期 <strong>${esc(cv2Range(period.currentFrom,period.currentThrough))}</strong></span></div><p class="fine">${esc(caption)} 營運落差本身不證明政策或活動的因果。</p><div class="market-benchmark-grid">${metricCards}</div><p class="market-benchmark-note">六個自有站使用已確認幣商；競品保留候選情境；未取得名冊者不試算，未核實成交現金，不列正式營收。缺值保留「—」；前期為零或負值只看差額。發又發的近七日不外推月同期。</p>`+cv2Details('買賣幣換算金額、差額與來源',table(['站點','身分口徑','方向','前期換算額','本期換算額','差額','幅度','換算公式'],financialRows)+`<div class="market-funding-evidence">${sources}</div>`)+cv2Details('註冊人數變化與完整比較數值',`<div class="grid-equal"><div>${cv2Diverging(items,'nu')}</div><div>${table(['站點','官儲幅度','DAU幅度','註冊人數變化','同期截止'],items.map(i=>row([esc(i.name),cv2MarketChange(i.current.cash,i.previous.cash),cv2MarketChange(i.current.dau,i.previous.dau),cv2MarketChange(i.current.nu,i.previous.nu),esc(i.through)])))}<p class="source-note">註冊數依後台註冊／留存來源；沒有同期間註冊資料的站點以「—」呈現。</p></div></div>`))+sourceNote(`全部指標均限 ${period.previousFrom}–${period.previousThrough} 對 ${period.currentFrom}–${period.currentThrough}，每項獨立核對完整日期。官儲、DAU來自消費日報；買賣幣來自同期間完整收贈禮，換算依各站指定比率。`);
}
