/* Creation cohorts and financial periods are independent evidence sources. */
function memberMixPanel(platform=state.product,month=state.month){
 const finite=v=>typeof v==='number'&&Number.isFinite(v)&&v>=0,date=v=>/^\d{4}-\d{2}-\d{2}$/.test(v||'')&&Number.isFinite(Date.parse(v))&&new Date(v).toISOString().slice(0,10)===v?v:null;
 const parent=Array.isArray(D.memberComposition)?D.memberComposition.find(r=>r.platform===platform&&r.month===month):D.memberComposition?.[platform]?.[month]||null;
 const availability=D.platforms?.find(p=>p.key===platform)?.availability??parent?.availability,availabilityNote=availability?.state==='temporarily_unavailable'?'後台暫停，保留既有分群及實際截止日。':availability?.state==='recovery_reported'?'已回報後台恢復登入；新名單仍需重新採集與核對，恢復登入不代表資料已更新。':'';
 const metric=key=>{
  const r=parent?.metrics?.[key];if(!r)return{key,total:null,groups:null,status:'missing',from:null,through:null,source:'',reason:key==='mau'||key==='dau'?'缺少創帳 AID × 期間登入交集':'完整儲值排行與創帳名單待補'};
  const from=date(r.from),through=date(r.through),periodValid=from===month+'-01'&&through?.startsWith(month)&&through>=from,total=finite(r.total)&&periodValid?r.total:null;
  const unknown=r.unknown===undefined&&r.verified===true&&r.complete===true?0:r.unknown,parts=[r.newRegistered,r.existing,unknown],whole=['paidMembers','mau'].includes(key);
  const groups=total!==null&&parts.every(finite)&&(!whole||[total,...parts].every(Number.isInteger))&&Math.abs(parts.reduce((s,v)=>s+v,0)-total)<=Math.max(.01,total*1e-9)?{fresh:parts[0],existing:parts[1],unknown:parts[2]}:null;
  const verified=!!groups&&r.verified===true&&r.complete===true&&groups.unknown===0;
  return{key,total,groups,status:verified?'verified':groups?'observed':'missing',from,through,source:r.source||'後台來源',capturedAt:r.capturedAt,files:Array.isArray(r.sourceFiles)?r.sourceFiles:[],reason:r.unknownReason,partial:r.partial===true};
 };
 const values={deposit:metric('deposit'),paidMembers:metric('paidMembers'),mau:metric('mau'),dau:metric('dau')},money=values.deposit;
 const share=(v,t)=>t>0?num(v/t*100,2)+'%':'—';
 const verdict=money.status==='verified'?money.total===0?'此期間尚無官儲':money.groups.existing>money.groups.fresh?'官儲以既有玩家為主':money.groups.existing<money.groups.fresh?'官儲以當月新註冊玩家為主':'新舊玩家官儲各占一半':money.status==='observed'?'官儲分群仍有待分類會員':'新舊玩家貢獻，等待完整創帳交集';
 const older=!!(parent?.requestedThrough&&money.through&&money.through<parent.requestedThrough);
 const description=money.status==='verified'&&money.total>0?`此前註冊貢獻 ${share(money.groups.existing,money.total)}，當月新註冊貢獻 ${share(money.groups.fresh,money.total)}。`:money.status==='observed'?`已匹配的當月創帳官儲 ${num(money.groups.fresh,2)} 元；待分類 ${num(money.groups.unknown,2)} 元。未匹配不直接判為既有玩家。`:'官儲與付費人數可依完整 AID 名單分群；活躍分群另需可核對的登入來源。';
 const labels=[['deposit','官儲金額','元'],['paidMembers','官儲付費人數','人'],['mau','月活躍 MAU','人'],['dau','日均活躍 DAU','人／日']];
 const cards=labels.map(([key,label,unit])=>{
  const v=values[key],digits=key==='deposit'?2:key==='dau'?1:0,status=v.status==='verified'?'已對平':v.status==='observed'?'部分匹配':'分群待補';
  const title=`<div class="mm-heading"><h3>${label}</h3><span>${status}</span></div>`,total=`<div class="mm-total">${num(v.total,digits)}<small>${unit}${v.status==='missing'&&v.total!==null?' · 僅總量':''}</small></div>`;
  const groups=v.groups?`<div class="mm-track" role="img" aria-label="此前註冊${num(v.groups.existing,digits)}，當月新註冊${num(v.groups.fresh,digits)}，待分類${num(v.groups.unknown,digits)}">${[['existing',v.groups.existing],['new',v.groups.fresh],['unknown',v.groups.unknown]].map(([cls,value])=>`<span class="mm-${cls}" style="width:${v.total?value/v.total*100:0}%"></span>`).join('')}</div>${[['existing','此前註冊',v.groups.existing],['new','當月新註冊',v.groups.fresh],['unknown','待分類',v.groups.unknown]].filter(([cls,,value])=>cls!=='unknown'||value>0).map(([cls,name,value])=>`<div class="mm-group"><span><i class="mm-${cls}-dot"></i>${name}</span><b>${num(value,digits)}</b><strong>${share(value,v.total)}</strong></div>`).join('')}`:`<p class="mm-awaiting">${key==='mau'?'尚無期間登入 AID 的月去重交集；最後登入快照不能還原歷史。':key==='dau'?'需逐日登入 AID 與創帳名單；不以付費或註冊人數推算。':'完整排行、創帳分頁或同期註冊數尚未核對完成。'}</p>`;
  const period=v.from&&v.through?`${v.from} — ${v.through}`:'來源期間待補';
  return `<article class="mm-metric ${v.status==='missing'?'pending':v.status==='observed'?'observed':''}" data-member-metric="${key}" data-member-status="${v.status}">${title}${total}${groups}<p class="mm-source">${esc(v.source||'後台來源待補')} · ${esc(period)}${v.partial?' · 含採集當日未結進度':''}${v.capturedAt?'<br>採集 '+esc(v.capturedAt):''}</p></article>`;
 }).join('');
 const old=platform==='win'?D.channels?.periods?.find(r=>r.month===month):null;
 const legacy=old&&finite(old.firstPaidCash)?`<details class="mm-evidence mm-legacy"><summary>舊渠道快照參考 · 不作本期完整分群</summary><p>${esc(old.start||month+'-01')} — ${esc(old.cutoff||'待補')}：已匹配當月創帳官儲 ${num(old.firstPaidCash,2)} 元。此舊資料未依本次完整創帳 AID、分頁與註冊總數重新核對，不將其餘金額自動歸為既有玩家。</p><p>${esc(old.membersSource?.file||'')} ／ ${esc(old.depositsSource?.file||'')}</p></details>`:'';
 const sourceRows=(parent?.sources||[]).map(r=>row([esc(r.file||'—'),esc(r.from||'—')+' — '+esc(r.through||'—'),esc(r.capturedAt||'—'),r.complete===true?'完整來源':'觀測來源']));
 const evidence=parent?`<details class="mm-evidence"><summary>分群依據與缺口</summary><p>創帳名單 ${num(parent.cohortCoverage?.uniqueAIDs)} 個唯一 AID；同期間玩家總覽註冊 ${num(parent.cohortCoverage?.registrationCount)} 人。${parent.cohortCoverage?.complete===true?'完整新註冊母體已對平，才可用排除法辨識此前註冊的付費者。':'尚未完成完整母體核對，未匹配者保留待分類。'}</p>${sourceRows.length?table(['來源','區間','採集時間','完整度'],sourceRows):''}<p>MAU／DAU 仍缺創帳與登入 AID 交集。競品若權限未開放會員明細，保留資料缺口，不由聚合註冊量或候選買賣量反推。</p></details>`:'';
 return `<section class="member-mix-panel"><header><div><span class="mm-kicker">MEMBER CONTRIBUTION · 當月註冊 vs 此前註冊</span><h2>${esc(verdict)}</h2><p>${esc(description)}</p></div><span class="mm-month">${esc(month)}</span></header>${availabilityNote?`<p class="mm-lag">${esc(availabilityNote)}</p>`:''}${older?`<p class="mm-lag">本區付費分群截至 ${esc(money.through)}；本次目標 ${esc(parent.requestedThrough)} 的付費名單仍待更新，未將舊期延伸到新截止日。</p>`:''}<div class="mm-grid">${cards}</div>${evidence}${legacy}<p class="mm-definition">新玩家＝本月註冊且在標示期間官儲／活躍；此前註冊須有完整母體或創帳證據。首次付費、首次登入、0日登及最後登入快照均不直接代替分群。各卡依自己的來源截止日。</p></section>`;
}
