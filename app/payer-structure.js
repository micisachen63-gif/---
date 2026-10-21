/* Optional full-funding source: D.payerStructure [{platform,month,verified:true,
 * complete:true,scope:'allPayin',merchantCovered:true,total,through,
 * payers:[{aid,name,amount}]}]. Official rankings remain the default source. */
const payerStructureThresholds={small:1000,large:20000};
function payerStructureData(platform,month){
 const finite=v=>typeof v==='number'&&Number.isFinite(v)&&v>=0;
 const sources=D.payerStructure;
 const full=Array.isArray(sources)?sources.find(x=>x.platform===platform&&x.month===month):sources?.[platform]?.[month];
 const useFull=full?.verified===true&&full.complete===true&&full.scope==='allPayin'&&full.merchantCovered===true;
 const official=D.payments?.months?.find(x=>x.platform===platform&&x.month===month);
 const p=useFull?full:official;
 if(!p||p.complete===false||p.verified===false||!Array.isArray(p.payers))return null;
 const byAid=new Map();
 for(const r of p.payers){
  const amount=useFull?r.amount:r.cash;
  if(!r.aid||!finite(amount))return null;
  if(amount===0)continue;
  const aid=String(r.aid),before=byAid.get(aid);
  byAid.set(aid,{aid,name:r.name||'未提供暱稱',amount:amount+(before?.amount||0)});
 }
 const payers=[...byAid.values()],total=payers.reduce((s,r)=>s+r.amount,0);
 if(finite(p.total)&&Math.abs(total-p.total)>.01)return null;
 if(Number.isInteger(p.uniquePayers)&&p.uniquePayers!==payers.length)return null;
 const through=String(p.through||p.cutoff||p.period?.to||'');
 if(!through.startsWith(month))return null;
 return{payers,total,through,scope:useFull?'官儲＋幣商買幣換算':'官儲',source:useFull?'已驗證完整補入明細':'後台期間儲值排行'};
}
function payerStructurePanel(platform=state.product,month=state.month){
 const data=payerStructureData(platform,month),t=payerStructureThresholds;
 const shell=body=>`<section class="ps-panel" data-payer-structure data-platform="${esc(platform)}" data-month="${esc(month)}">${body}</section>`;
 if(!data)return shell('<div class="ps-heading"><div><span class="ps-eyebrow">PAYER MIX</span><h2>大中小 R 付費結構</h2><p>完整期間付費名單尚待接入，取得後呈現人數與金額占比。</p></div></div>');
 const bands=[{name:'小 R',rule:`≤ ${num(t.small)}`,cls:'small',test:v=>v<=t.small},{name:'中 R',rule:`> ${num(t.small)} 至 ${num(t.large)}`,cls:'middle',test:v=>v>t.small&&v<=t.large},{name:'大 R',rule:`> ${num(t.large)}`,cls:'large',test:v=>v>t.large}].map(b=>{
  const group=data.payers.filter(r=>b.test(r.amount)),cash=group.reduce((s,r)=>s+r.amount,0);
  return{...b,count:group.length,cash,peopleShare:data.payers.length?group.length/data.payers.length:0,cashShare:data.total?cash/data.total:0};
 });
 const share=v=>num(v*100,1)+'%',big=bands[2];
 const conclusion=data.total===0?'此期間尚無付費金額。':big.count===0?'本期沒有超過大 R 門檻的付費會員。':`大 R ${num(big.count)} 人，占付費人數 ${share(big.peopleShare)}，貢獻 ${share(big.cashShare)} ${data.scope}。${big.cashShare>=.5?'金額較集中於大 R。':'其餘金額由中小 R 共同支撐。'}`;
 const stacked=(key,label)=>`<div class="ps-stack-row"><span>${label}</span><div class="ps-stack" aria-label="${esc(label)}">${bands.map(b=>`<span class="ps-${b.cls}" style="width:${b[key]*100}%" title="${esc(b.name)} ${share(b[key])}">${b[key]>=.12?share(b[key]):''}</span>`).join('')}</div></div>`;
 return shell(`<div class="ps-heading"><div><span class="ps-eyebrow">PAYER MIX · ${esc(data.scope)}口徑</span><h2>大中小 R 付費結構</h2><p>以當月期間付費分類，呈現誰在付費、誰貢獻金額。</p></div><span class="ps-period">${esc(month)}-01 — ${esc(data.through)}</span></div><p class="ps-conclusion">${esc(conclusion)}</p><div class="ps-distribution">${stacked('peopleShare','付費人數占比')}${stacked('cashShare',data.scope+'金額占比')}</div><div class="ps-cards">${bands.map(b=>`<article class="ps-tier ps-${b.cls}"><div class="ps-tier-title"><h3>${b.name}</h3><span>${esc(b.rule)} 元</span></div><div class="ps-tier-stat"><strong>${num(b.count)}<small>人</small></strong><span>人數占比 ${share(b.peopleShare)}</span></div><div class="ps-tier-money"><b>${num(b.cash)}</b><span>元 · 金額占比 ${share(b.cashShare)}</span></div></article>`).join('')}</div><form class="ps-controls"><span>分層門檻</span><label>小 R 上限<input name="small" type="number" min="0" step="1" value="${t.small}" required aria-label="小 R 金額上限"></label><label>中 R 上限<input name="large" type="number" min="1" step="1" value="${t.large}" required aria-label="中 R 金額上限"></label><button type="submit">套用</button><button type="button" data-payer-reset>重設</button><span class="ps-input-error" role="status"></span></form><p class="ps-source">${esc(data.source)} · ${num(data.payers.length)} 位付費會員 · ${data.scope}合計 ${num(data.total)} 元。門檻套用於目前開啟的儀表盤，不影響後台；非 VIP 或歷史累計分層。${data.scope==='官儲'?'幣商買幣未併入本分層。':''}</p>`);
}
function bindPayerStructure(container=document){
 container.querySelectorAll('[data-payer-structure]').forEach(el=>{
  const form=el.querySelector('.ps-controls');if(!form)return;
  const update=()=>{const html=payerStructurePanel(el.dataset.platform,el.dataset.month);el.outerHTML=html;bindPayerStructure(container)};
  form.onsubmit=e=>{e.preventDefault();const small=Number(form.elements.small.value),large=Number(form.elements.large.value);if(!Number.isFinite(small)||!Number.isFinite(large)||small<0||large<=small){form.querySelector('.ps-input-error').textContent='中 R 上限需高於小 R 上限。';return}payerStructureThresholds.small=small;payerStructureThresholds.large=large;update()};
  form.querySelector('[data-payer-reset]').onclick=()=>{payerStructureThresholds.small=1000;payerStructureThresholds.large=20000;update()};
 });
}
function payerAttentionPanel(platform=state.product,month=state.month){
 const c=D.cohorts?.find(x=>x.platform===platform&&x.current===month);
 if(!c||!Array.isArray(c.rows))return`<section class="ps-panel ps-attention"><div class="ps-heading"><div><span class="ps-eyebrow">PAYER WATCH</span><h2>付費注意名單</h2><p>前後月完整 AID 名單尚待接入。</p></div></div></section>`;
 const valid=v=>typeof v==='number'&&Number.isFinite(v)&&v>=0;
 const known=(r,k)=>c.merchantCovered===true&&r.merchantCovered!==false&&valid(r[k]);
 const candidates=c.rows.filter(r=>valid(r.prevCash)&&r.prevCash>0&&valid(r.currentCash)&&(r.currentCash===0||r.currentCash/r.prevCash<.5)).sort((a,b)=>b.prevCash-a.prevCash);
 const shifts=candidates.filter(r=>r.currentCash===0&&known(r,'currentCoins')&&r.currentCoins>0),unrenewed=candidates.filter(r=>r.currentCash===0&&!shifts.includes(r)),down=candidates.filter(r=>r.currentCash>0);
 const classify=r=>{
  if(r.currentCash===0&&known(r,'currentCoins')&&r.currentCoins>0)return{level:'通路轉移',cls:'shift',reason:'未官儲，仍向幣商買幣；不能視為流失'};
  if(r.currentCash===0)return{level:r.prevCash>20000?'優先注意':'待追蹤',cls:r.prevCash>20000?'priority':'watch',reason:known(r,'currentCoins')?'截至目前未續購，官儲與指定幣商買幣皆為 0':'截至目前未官儲；幣商買幣資料未知'};
  return{level:r.prevCash>20000?'重點觀察':'觀察',cls:'decline',reason:`官儲較前月減少 ${num((1-r.currentCash/r.prevCash)*100,1)}%；仍有官儲`};
 };
 const coins=(r,key)=>{if(!known(r,key))return'<span class="ps-unknown">未知</span>';return typeof coinCell==='function'?coinCell(platform,'buy',r[key]):`${num(r[key])}<span class="sub">金幣 · 換算待設定</span>`};
 const rows=candidates.slice(0,20).map(r=>{const a=classify(r);return`<tr class="clickable" data-player="${esc(String(r.aid))}" tabindex="0"><td><span class="row-name">${esc(r.name||'未提供暱稱')}</span><span class="sub aid">${esc(String(r.aid))}</span></td><td>${num(r.prevCash)}</td><td>${num(r.currentCash)}</td><td>${coins(r,'prevCoins')}</td><td>${coins(r,'currentCoins')}</td><td><span class="ps-badge ps-${a.cls}">${a.level}</span><span class="ps-reason">${esc(a.reason)}</span></td></tr>`}).join('');
 return`<section class="ps-panel ps-attention"><div class="ps-heading"><div><span class="ps-eyebrow">PAYER WATCH · 前月官儲會員</span><h2>付費注意名單</h2><p>依前月官儲由高至低，優先查看尚未續購與官儲減少的會員。</p></div><a class="ps-link" href="#playerRows" data-go="retention">查看完整會員名單 →</a></div><div class="ps-watch-summary"><div><strong>${num(unrenewed.length)}</strong><span>尚未再官儲，待追蹤</span></div><div><strong>${num(down.length)}</strong><span>官儲減少逾 50%</span></div><div><strong>${num(shifts.length)}</strong><span>未官儲但仍買幣</span></div></div><p class="ps-comparison">${esc(c.previous)} 整月 → ${esc(c.current)} 截至 ${esc(c.cutoff)}${Number(String(c.cutoff).slice(-2))<new Date(Number(month.slice(0,4)),Number(month.slice(5,7)),0).getDate()?' · 本月尚未結束，差額反映進度，非完整月衰退。':' · 以兩月完整期間比較。'}</p>${rows?`<div class="ps-table-wrap"><table><thead><tr><th>AID／暱稱</th><th>前月官儲</th><th>本月官儲</th><th>前月買幣換算</th><th>本月買幣換算</th><th>注意級別／原因</th></tr></thead><tbody>${rows}</tbody></table></div>`:'<p class="ps-empty">此期間沒有符合「未官儲或官儲減少逾 50%」的前月付費會員。</p>'}<p class="ps-source">後台逐月儲值排行${c.merchantCovered===true?'＋指定幣商收贈禮':'；幣商買幣資料待補'} · 共 ${num(candidates.length)} 位符合條件，顯示前 ${Math.min(20,candidates.length)} 位。未續購不等於已離站；買幣金額依指定比率換算。</p></section>`;
}
