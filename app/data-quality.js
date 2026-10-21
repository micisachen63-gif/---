function dataQualityPanel(platform=state.product,month=state.month,focused=false){
 const audit=D.qualityAudit;if(!audit)return '';
 const inScope=r=>(platform==='all'||r.platform===platform)&&(!focused||r.month===month);
 const exceptions=(audit.rankings||[]).filter(r=>r.quarantined&&inScope(r));
 if(focused&&!exceptions.length)return '';
 const name=key=>D.platforms.find(p=>p.key===key)?.name||D.competitors?.find(p=>p.key===key)?.name||key;
 const coverage=(audit.coverage?.payerRanks?.byPlatform||[]).filter(p=>platform==='all'||p.platform===platform);
 if(!coverage.length&&!exceptions.length)return '';
 const expected=coverage.reduce((s,p)=>s+p.expectedFiles,0),present=coverage.reduce((s,p)=>s+p.presentFiles,0),matched=coverage.reduce((s,p)=>s+p.cashReconciledMonths.length,0);
 const detail=exceptions.length?table(['平台 / 月份','排行官儲','日報官儲','差額','處理狀態'],exceptions.map(r=>row([esc(name(r.platform))+' · '+esc(r.month),num(r.rankingCash),num(r.cashComparison?.cash),diff(r.rankingCash,r.cashComparison?.cash),'待後台對平，暫不計入付費結構及流失判定']))):'<p class="fine">本範圍沒有已隔離的排行差額。缺少來源仍維持待補。</p>';
 const summary=focused?'這份會員排行與日報尚有差額':`${present} / ${expected} 份正式排行 · ${matched} 份已與完整日報對平`;
 return panel('資料核對狀態',summary,`<div class="notice">會員排行與每日報表分開核對。金額不符的來源保留查核紀錄，不能當作已確認的營收或流失。${focused?'':'開服後缺日及尚未取得的來源，均不補零。'}</div>${detail}${focused?'':sourceNote('品質稽核 '+audit.auditThrough+'；來源列合計吻合只確認數值，機台的查詢期間仍另行驗證。')}`);
}
