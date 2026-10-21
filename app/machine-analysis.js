/* Report units are game coins. An absent machine ID stays null. */
const machineAnalysisState={minBet:1000000,minRounds:1000,lowRtp:85,highRtp:105,query:'',filter:'all',sort:'bets',direction:'desc',page:1,advanced:false};
function machineAnalysisRows(platform,month){
 const nonnegative=v=>typeof v==='number'&&Number.isFinite(v)&&v>=0;
 const source=(D.machines?.rows||[]).filter(r=>r.platform===platform&&r.from===month+'-01'&&typeof r.through==='string'&&r.through.startsWith(month)&&r.through>=r.from&&r.verified!==false&&!['vendor','provider','game','platform','aggregate','summary'].includes(r.granularity||r.level||r.scope)&&r.isAggregate!==true&&(r.machineId||(r.vendor&&r.machineName)||r.identityMissing===true));
 const through=source.map(r=>r.through).sort().at(-1)||null;
 const keys=new Map(),bad=new Set();
 for(const [index,raw] of source.filter(r=>r.through===through).entries()){
  const r={...raw};for(const field of ['bets','payouts','rounds','players','effectiveBets'])r[field]=nonnegative(r[field])?r[field]:null;
  for(const field of ['gameProfit','eventBonus','reportedRtp'])r[field]=typeof r[field]==='number'&&Number.isFinite(r[field])?r[field]:null;
  r.rtp=r.bets>0&&r.payouts!==null?r.payouts/r.bets:null;
  r.platformLoss=r.bets!==null&&r.payouts!==null?r.payouts-r.bets:null;
  const key=r.machineId?JSON.stringify([r.vendor,r.gameName,r.machineId]):r.observationKey||JSON.stringify([r.vendor,r.gameName,r.machineName,r.sourceRow??index]);
  if(bad.has(key))continue;
  if(keys.has(key)){const old=keys.get(key);if(['bets','payouts','rounds','players'].some(k=>old[k]!==r[k])){keys.delete(key);bad.add(key)}continue}
  keys.set(key,r);
 }
 const rows=[...keys.values()];
 const snapshot=D.machines?.snapshots?.find(s=>s.platform===platform&&s.from===month+'-01'&&s.through===through)||(!through?D.machines?.snapshots?.find(s=>s.platform===platform&&(s.month===month||s.from===month+'-01')):null)||null;
 return{rows,through,snapshot,conflicting:bad.size};
}
function machineObservation(r,config=machineAnalysisState){
 if(r.bets===null||r.payouts===null)return{kind:'missing',label:'欄位待補',detail:'投注或出分未知，無法計算 RTP'};
 if(r.bets===0)return{kind:'sample',label:'無投注',detail:'投注為 0，不計算 RTP'};
 if(r.rounds===null)return{kind:'sample',label:'樣本不足',detail:'投注筆數未知，不能判定已達樣本門檻'};
 if(r.bets<config.minBet||r.rounds<config.minRounds)return{kind:'sample',label:'樣本不足',detail:'投注額或投注筆數尚未達門檻'};
 if(r.rtp*100>config.highRtp)return{kind:'high',label:'高 RTP 觀察',detail:'樣本達門檻，RTP 高於設定上限'};
 if(r.rtp*100<config.lowRtp)return{kind:'low',label:'低 RTP 觀察',detail:'樣本達門檻，RTP 低於設定下限'};
 return{kind:'normal',label:'門檻內',detail:'樣本達門檻，RTP 在設定範圍內'};
}
function machinePeriodLabel(snapshot,through){
 if(snapshot?.partial===true){const today=new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Taipei',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());return'未結月'+(through===today?' · 含今日':'')}
 return snapshot?.partial===false?'完整期間':'截至已取得日期';
}
function machineSourceWarning(snapshot){
 const warning=snapshot?.sourceValidation?.periodWarning;
 if(typeof warning!=='string'||!warning.trim())return'';
 const e=typeof esc==='function'?esc:v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 return`<p class="ma-source-warning" role="status">資料期間待核對：${e(warning)}</p>`;
}
function machineOverviewPanel(month){
 const e=typeof esc==='function'?esc:v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const platforms=D.platforms||[],items=platforms.map(p=>({p,...machineAnalysisRows(p.key,month)})),covered=items.filter(x=>x.rows.length),dates=[...new Set(covered.map(x=>x.through))];
 const n=v=>v===null?'—':num(v),pct=v=>v===null?'—':num(v*100,2)+'%';
 return`<div class="machine-analysis ma-all"><header class="ma-page-heading"><div><span class="ma-eyebrow">MACHINE COVERAGE</span><h2>各站機台來源與表現</h2><p>各站金額使用自己的報表遊戲幣。站與站可能有單位差異，請分站閱讀。</p></div><span class="ma-period">${e(month)}</span></header><section class="ma-coverage-banner"><div><strong>${covered.length}<small>／${platforms.length} 站</small></strong><span>已有本月機台明細</span></div><p>${dates.length===1?'目前已取得來源截至 '+e(dates[0]):dates.length?'目前來源含 '+dates.length+' 個不同截止日，日期列於各站卡片。':'當月機台來源待收集。'}<br>來源覆蓋是資料取得狀態；投注、出分、RTP 於各站期間內計算。</p></section><div class="ma-platform-grid">${items.map(({p,rows,through,snapshot})=>{
  const sum=key=>rows.length&&rows.every(r=>r[key]!==null)?rows.reduce((a,r)=>a+r[key],0):null,bets=sum('bets'),payouts=sum('payouts'),rtp=bets>0&&payouts!==null?payouts/bets:null;
  const matches=rows.length&&['bets','payouts'].every(k=>snapshot?.reconciliation?.[k]?.matches===true);
  return`<article class="ma-platform-card${rows.length?'':' ma-pending'}"><div class="ma-platform-title"><h3>${e(p.name||p.key)}</h3><span>${rows.length?'已收錄':snapshot?.sourceValidation?.valid===false?'待核對':'待收集'}</span></div><p class="ma-platform-period">${through?e(month)+'-01 — '+e(through)+' · '+machinePeriodLabel(snapshot,through):e(month)+' 當月來源待補'}</p>${machineSourceWarning(snapshot)}<dl><div><dt>投注</dt><dd>${n(bets)}<small>遊戲幣</small></dd></div><div><dt>出分</dt><dd>${n(payouts)}<small>遊戲幣</small></dd></div><div><dt>RTP</dt><dd>${pct(rtp)}<small>出分 ÷ 投注</small></dd></div></dl><p class="ma-platform-source">${rows.length?num(rows.length)+' 筆機台明細 · '+(matches?'明細與後台合計列一致':'後台合計列待核對'):'尚無可用機台明細'}</p><button type="button" data-product-link="${e(p.key)}">${rows.length?'查看機台分析':'查看來源狀態'} →</button></article>`;
 }).join('')}</div><p class="ma-source">各站獨立顯示原始報表單位，沒有跨站共同金額總計或共同排行榜。未結月可能含今日進行中數據；截止日期以各站卡片為準，這裡沒有用整月與未結月作同比。</p></div>`;
}
function machineAnalysisPanel(platform=state.product,month=state.month){
 if(platform==='all')return machineOverviewPanel(month);
 const escText=typeof esc==='function'?esc:v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const n=(v,d=0)=>v===null||v===undefined?'—':num(v,d),pct=v=>v===null?'—':num(v*100,2)+'%';
 const {rows,through,snapshot,conflicting}=machineAnalysisRows(platform,month),s=machineAnalysisState;
 const shell=body=>`<div class="machine-analysis" data-machine-analysis data-platform="${escText(platform)}" data-month="${escText(month)}">${body}</div>`;
 const title=`<header class="ma-page-heading"><div><span class="ma-eyebrow">MACHINE INTELLIGENCE</span><h2>機台投注與出分觀察</h2><p>從投注規模、平台失分與 RTP，找出值得進一步查看的機台。</p></div><span class="ma-period">${escText(month)}${through?' · 截至 '+escText(through)+'<br>'+machinePeriodLabel(snapshot,through):''}</span></header>`;
 if(!rows.length)return shell(title+machineSourceWarning(snapshot)+`<section class="ma-empty"><span class="ma-empty-symbol">◈</span><h3>${snapshot?.sourceValidation?.valid===false?'本月機台來源待核對':'本月機台明細待收集'}</h3><p>需要後台「機台總覽」的當月投注、總出分與投注筆數。供應商合計不會代替機台資料。</p><span>來源：遊戲報表 → 機台總覽 · ${escText(month)}-01 起</span></section>`);
 const sum=key=>rows.every(r=>r[key]!==null)?rows.reduce((a,r)=>a+r[key],0):null;
 const bets=sum('bets'),payouts=sum('payouts'),weighted=bets>0&&payouts!==null?payouts/bets:null;
 const lossRows=rows.filter(r=>r.platformLoss>0).sort((a,b)=>b.platformLoss-a.platformLoss),loss=rows.every(r=>r.platformLoss!==null)?lossRows.reduce((a,r)=>a+r.platformLoss,0):null;
 const observed=rows.map(r=>({row:r,...machineObservation(r)})),high=observed.filter(r=>r.kind==='high'),low=observed.filter(r=>r.kind==='low'),sample=observed.filter(r=>r.kind==='sample'),complete=observed.filter(r=>['high','low','normal'].includes(r.kind));
 const allNames=rows.every(r=>!r.machineId),nameCounts=new Map();for(const r of rows){const key=JSON.stringify([r.vendor,r.machineName]);nameCounts.set(key,(nameCounts.get(key)||0)+1)}
 const kpi=(label,value,unit,foot)=>`<article class="ma-kpi"><span>${label}</span><strong>${value}</strong><small>${unit}</small><p>${foot}</p></article>`;
 const top=title+machineSourceWarning(snapshot)+`<section class="ma-kpis">${kpi('已收錄機台投注',n(bets),'遊戲幣',num(rows.length)+' 筆後台機台明細')}${kpi('已收錄機台出分',n(payouts),'遊戲幣','來源總出分，不是淨輸贏')}${kpi('整體 RTP',pct(weighted),'出分 ÷ 投注','以投注加權，不平均各機台 RTP')}${kpi('失分機台差額合計',n(loss),'遊戲幣',num(lossRows.length)+' 項出分大於投注；未抵銷其他機台贏分')}</section>`;
 const rank=(items,key,label,color)=>{
  const list=items.slice(0,8),max=Math.max(1,...list.map(r=>r[key]));
  return`<section class="ma-section ma-rank-section"><div class="ma-section-heading"><div><h3>${label}</h3><p>${key==='bets'?'投注額最高的前 8 項':'總出分 − 總投注額 > 0，依失分額排列'}</p></div><span>遊戲幣</span></div>${list.length?`<div class="ma-rank-chart">${list.map((r,i)=>`<button class="ma-rank-row" type="button" data-machine-rank-query="${escText(r.machineId||r.machineName||'')}"><span class="ma-rank-index">${i+1}</span><span class="ma-rank-body"><span class="ma-rank-caption"><b>${escText(r.machineName||'後台未標示機台')}</b><strong>${n(r[key])}</strong></span><span class="ma-rank-track"><i style="width:${r[key]/max*100}%;background:${color}"></i></span><span class="ma-rank-vendor">${escText(r.vendor||'廠商未提供')} · RTP ${pct(r.rtp)}${r.identityMissing?' · 待歸屬':''}</span></span></button>`).join('')}</div>`:`<p class="ma-chart-empty">${key==='bets'?'本期投注欄位待補。':'本期沒有出分高於投注的已收錄機台。'}</p>`}</section>`;
 };
 const ranks=`<div class="ma-rank-grid">${rank([...rows].filter(r=>r.bets!==null).sort((a,b)=>b.bets-a.bets),'bets','機台投注榜','#c6ae78')}${rank(lossRows,'platformLoss','平台失分榜','#7eafba')}</div>`;
 const input=(name,label,value,step=1)=>`<label>${label}<input type="number" name="${name}" min="0" step="${step}" value="${value}" required></label>`;
 const controls=`<section class="ma-section ma-observation"><div class="ma-section-heading"><div><h3>RTP 門檻觀察</h3><p>先達到樣本門檻，再檢視設定範圍外的機台。</p></div><span class="ma-observe-tag">營運觀察</span></div><div class="ma-observe-summary"><div><strong>${high.length}</strong><span>高於 RTP 上限</span></div><div><strong>${low.length}</strong><span>低於 RTP 下限</span></div><div><strong>${sample.length}</strong><span>樣本不足／無投注</span></div><p>${complete.length} 項達到投注與筆數門檻。門檻外只代表需要查看${observed.some(r=>r.kind==='missing')?'；另有 '+observed.filter(r=>r.kind==='missing').length+' 項欄位待補':''}，不能單憑 RTP 推定原因。</p></div><form class="ma-threshold-form">${input('minBet','最低投注額（遊戲幣）',s.minBet)}${input('minRounds','最低投注筆數',s.minRounds)}${input('lowRtp','RTP 下限（%）',s.lowRtp,.1)}${input('highRtp','RTP 上限（%）',s.highRtp,.1)}<button type="submit">套用門檻</button><button type="button" data-machine-reset>重設</button><span class="ma-form-error" role="status"></span></form><p class="ma-note">投注筆數是本報表的樣本欄位；未知時一律標示樣本不足。預設額度 1,000,000、筆數 1,000、RTP 85%–105%，可按營運需要調整；不代表遊戲理論 RTP。</p></section>`;
 const text=[r=>r.machineId,r=>r.machineName,r=>r.gameName,r=>r.vendor];
 const q=s.query.trim().toLowerCase();
 const filtered=rows.filter(r=>(!q||text.map(fn=>fn(r)||'').join(' ').toLowerCase().includes(q))&&(s.filter==='all'||s.filter==='loss'&&r.platformLoss>0||s.filter==='observe'&&['high','low'].includes(machineObservation(r).kind)||s.filter==='sample'&&['sample','missing'].includes(machineObservation(r).kind)));
 const sorted=[...filtered].sort((a,b)=>{const av=a[s.sort],bv=b[s.sort];if(av===null||av===undefined)return bv===null||bv===undefined?0:1;if(bv===null||bv===undefined)return-1;const delta=typeof av==='number'&&typeof bv==='number'?av-bv:String(av).localeCompare(String(bv),'zh-Hant');return(s.direction==='asc'?delta:-delta)||String(a.machineId||a.machineName).localeCompare(String(b.machineId||b.machineName),'zh-Hant')});
 const pages=Math.max(1,Math.ceil(sorted.length/20)),page=Math.min(s.page,pages),visible=sorted.slice((page-1)*20,page*20);
 const head=(key,label)=>`<th${key==='machineName'?' class="ma-name-column"':''}>${key?`<button type="button" data-machine-sort="${key}" aria-label="依${label}排序">${label}<span>${s.sort===key?s.direction==='asc'?'↑':'↓':'↕'}</span></button>`:label}</th>`;
 const heads=head('machineId','機台 ID')+head('machineName','機台名稱')+head('gameName','遊戲')+head('vendor','廠商')+head('bets','總投注')+head('payouts','總出分')+head('platformLoss','平台失分')+head('rtp','計算 RTP')+head('rounds','投注筆數')+head('players','不重複玩家')+(s.advanced?head('effectiveBets','有效投注')+head('gameProfit','來源遊戲淨利')+head('reportedRtp','報表 RTP')+head('eventBonus','活動加贈'):'')+head('','觀察');
 const body=visible.map(r=>{const o=machineObservation(r),repeated=nameCounts.get(JSON.stringify([r.vendor,r.machineName]))>1;return`<tr><td class="ma-id">${r.machineId?escText(r.machineId):'<span class="ma-unknown">後台未提供 ID</span>'}</td><td class="ma-name-column"><strong>${escText(r.machineName||'名稱未提供')}</strong>${repeated&&r.sourceRow?`<span class="ma-cell-note">同名明細 · 來源第 ${r.sourceRow} 列</span>`:''}</td><td>${r.gameName?escText(r.gameName):'<span class="ma-unknown">未另提供</span>'}</td><td>${escText(r.vendor||'未提供')}</td><td>${n(r.bets)}</td><td>${n(r.payouts)}</td><td class="${r.platformLoss>0?'ma-loss-value':''}">${n(r.platformLoss)}</td><td class="ma-rtp-value">${pct(r.rtp)}</td><td>${n(r.rounds)}</td><td>${n(r.players)}</td>${s.advanced?`<td>${n(r.effectiveBets)}</td><td>${n(r.gameProfit)}</td><td>${pct(r.reportedRtp)}</td><td>${n(r.eventBonus)}</td>`:''}<td><span class="ma-status ma-${o.kind}" title="${escText(o.detail)}">${o.label}</span>${r.rounds===null?'<span class="ma-cell-note">投注筆數未知</span>':''}</td></tr>`}).join('');
 const detail=`<section class="ma-section ma-detail" data-machine-detail><div class="ma-section-heading"><div><h3>機台明細</h3><p>${allNames?'此來源是後台機台名稱粒度，沒有實體機台 ID；遊戲欄僅顯示來源另外提供的遊戲名稱。':'機台 ID、名稱、遊戲與廠商分欄呈現；缺失欄位保持未知。'}</p></div><span>${num(filtered.length)} 項</span></div><div class="ma-toolbar"><label class="ma-search"><span>搜尋</span><input type="search" data-machine-search placeholder="機台 ID、名稱、遊戲、廠商" value="${escText(s.query)}"></label><label><span>顯示</span><select data-machine-filter><option value="all"${s.filter==='all'?' selected':''}>全部機台</option><option value="loss"${s.filter==='loss'?' selected':''}>平台失分</option><option value="observe"${s.filter==='observe'?' selected':''}>RTP 門檻外觀察</option><option value="sample"${s.filter==='sample'?' selected':''}>樣本不足／欄位待補</option></select></label><label class="ma-advanced"><input type="checkbox" data-machine-advanced${s.advanced?' checked':''}>進階來源欄位</label></div><div class="ma-table-scroll"><table><thead><tr>${heads}</tr></thead><tbody>${body||`<tr><td colspan="${s.advanced?15:11}" class="ma-no-match">沒有符合條件的機台。</td></tr>`}</tbody></table></div><div class="ma-pagination"><span>第 ${page}／${pages} 頁 · 每頁 20 項</span><div><button type="button" data-machine-page="${page-1}"${page<=1?' disabled':''}>上一頁</button><button type="button" data-machine-page="${page+1}"${page>=pages?' disabled':''}>下一頁</button></div></div><p class="ma-note">平台失分＝總出分－總投注；正值表示該期間出分超過投注，負值表示投注較高。投注、出分與失分均為遊戲幣，不是台幣。不同機台的不重複玩家數不能相加作平台 MAU。</p></section>`;
 const reconciliation=snapshot?.reconciliation,checks=reconciliation?['bets','payouts'].map(k=>reconciliation[k]?.matches):[];
 const checked=checks.length===2&&checks.every(v=>v===true),mismatch=checks.some(v=>v===false);
 const url=String(snapshot?.sourceUrl||rows[0].sourceUrl||''),safeUrl=/^https:\/\//i.test(url)?url:null;
 const capture=snapshot?.capturedAt||rows.map(r=>r.capturedAt).filter(Boolean).sort().at(-1);
 const source=`<footer class="ma-source">來源：${safeUrl?`<a href="${escText(safeUrl)}" target="_blank" rel="noopener noreferrer">後台遊戲報表／機台總覽 ↗</a>`:'後台遊戲報表／機台總覽'} · ${escText(month)}-01 — ${escText(through)}${capture?' · 擷取 '+escText(capture):''}<br>${checked?'投注與總出分已和後台合計列核對一致。':mismatch?'來源合計與已取得明細尚未核對一致；此頁合計僅涵蓋已收錄資料。':'後台合計列待核對；此頁合計僅涵蓋已收錄資料。'}${conflicting?' '+conflicting+' 組期間重複且數值衝突的資料已排除。':''} ${allNames?'無 ID 時按來源名稱列呈現，同廠商同名列仍保留；不當作實體機台 ID。':''} 來源遊戲淨利與報表 RTP 原值另存於進階欄位，不由計算值覆寫。</footer>`;
 return shell(top+ranks+controls+detail+source);
}
function bindMachineAnalysis(container=document){
 container.querySelectorAll('[data-machine-analysis]').forEach(el=>{
  const s=machineAnalysisState;
  const update=(focusSearch=false)=>{const platform=el.dataset.platform,month=el.dataset.month;el.outerHTML=machineAnalysisPanel(platform,month);bindMachineAnalysis(container);if(focusSearch){const input=container.querySelector('[data-machine-search]');if(input){input.focus();input.setSelectionRange(input.value.length,input.value.length)}}};
  const form=el.querySelector('.ma-threshold-form');
  if(form){form.onsubmit=e=>{e.preventDefault();const values=Object.fromEntries(['minBet','minRounds','lowRtp','highRtp'].map(k=>[k,Number(form.elements[k].value)]));if(Object.values(values).some(v=>!Number.isFinite(v)||v<0)||!Number.isInteger(values.minRounds)||values.highRtp<=values.lowRtp){form.querySelector('.ma-form-error').textContent='請輸入有效門檻；筆數需為整數，RTP 上限需高於下限。';return}Object.assign(s,values,{page:1});update()};form.querySelector('[data-machine-reset]').onclick=()=>{Object.assign(s,{minBet:1000000,minRounds:1000,lowRtp:85,highRtp:105,page:1});update()}}
  const search=el.querySelector('[data-machine-search]');if(search)search.oninput=e=>{s.query=e.target.value;s.page=1;update(true)};
  const filter=el.querySelector('[data-machine-filter]');if(filter)filter.onchange=e=>{s.filter=e.target.value;s.page=1;update()};
  const advanced=el.querySelector('[data-machine-advanced]');if(advanced)advanced.onchange=e=>{s.advanced=e.target.checked;update()};
  el.querySelectorAll('[data-machine-sort]').forEach(button=>button.onclick=()=>{const key=button.dataset.machineSort;s.direction=s.sort===key&&s.direction==='desc'?'asc':'desc';s.sort=key;s.page=1;update()});
  el.querySelectorAll('[data-machine-page]').forEach(button=>button.onclick=()=>{s.page=Math.max(1,Number(button.dataset.machinePage));update()});
  el.querySelectorAll('[data-machine-rank-query]').forEach(button=>button.onclick=()=>{s.query=button.dataset.machineRankQuery;s.filter='all';s.page=1;update();container.querySelector('[data-machine-detail]')?.scrollIntoView({behavior:'smooth',block:'start'})});
 });
}
