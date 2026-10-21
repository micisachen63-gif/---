/** Confirmed business rules only. Unknown platforms must remain unclassified. */
export const CHANNEL_QUALITY_RULES=Object.freeze({
 win:Object.freeze({ruleId:'win_initial_coin20_wash500_cash_exclusion',values:Object.freeze({coin:20,wash:500}),source:'既有已知Win初始資源門檻；使用者定義初始資源未變為營運無效',confirmedOn:'2026-10-21'})
});
export function channelQualityRule(platform,rules=CHANNEL_QUALITY_RULES){
 const rule=rules?.[platform],values=rule?.values;
 return rule&&typeof rule.ruleId==='string'&&rule.ruleId&&values&&['coin','wash'].every(k=>typeof values[k]==='number'&&Number.isFinite(values[k])&&values[k]>=0)?rule:null;
}
